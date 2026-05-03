import { FailureAlert, MaintenancePersonnel, PredictedFailure } from './types';
import { NotificationChannel } from './notification-channel';

export interface NotificationServiceConfig {
  channels: NotificationChannel[];
}

export class NotificationService {
  private readonly channelMap: ReadonlyMap<string, NotificationChannel>;

  constructor(config: NotificationServiceConfig) {
    const map = new Map<string, NotificationChannel>();
    for (const channel of config.channels) {
      map.set(channel.type, channel);
    }
    this.channelMap = map;
  }

  async notifyPredictedFailure(
    failure: PredictedFailure,
    recipients: MaintenancePersonnel[]
  ): Promise<FailureAlert> {
    const alert = this.createAlert(failure, recipients);

    const deliveryResults = await Promise.allSettled(
      recipients.flatMap((recipient) =>
        recipient.notificationPreferences
          .filter((pref) => pref.enabled)
          .map(async (pref) => {
            const channel = this.channelMap.get(pref.channel);
            if (!channel) {
              return;
            }
            await channel.send(alert, recipient);
          })
      )
    );

    const hasFailures = deliveryResults.some((r) => r.status === 'rejected');
    alert.status = hasFailures ? 'failed' : 'sent';
    return alert;
  }

  private createAlert(
    failure: PredictedFailure,
    recipients: MaintenancePersonnel[]
  ): FailureAlert {
    return {
      id: this.generateId(),
      failure,
      recipients,
      message: this.buildMessage(failure),
      timestamp: new Date(),
      status: 'pending',
    };
  }

  private buildMessage(failure: PredictedFailure): string {
    const date = failure.predictedFailureDate.toISOString();
    const confidence = `${(failure.confidence * 100).toFixed(1)}%`;
    return (
      `Alert: Predicted failure for ${failure.componentName} (${failure.componentId}). ` +
      `Severity: ${failure.severity}. Predicted date: ${date}. Confidence: ${confidence}. Description: ${failure.description}`
    );
  }

  private generateId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
