import { NotificationChannel } from '../notification-channel';
import { FailureAlert, MaintenancePersonnel } from '../types';

export class ConsoleNotificationChannel implements NotificationChannel {
  readonly type = 'in_app';

  async send(alert: FailureAlert, recipient: MaintenancePersonnel): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[NOTIFICATION][${this.type}] To: ${recipient.name} <${recipient.email}> | Alert ${alert.id}: ${alert.message}`
    );
  }
}
