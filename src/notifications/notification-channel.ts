import { FailureAlert, MaintenancePersonnel } from './types';

export interface NotificationChannel {
  readonly type: string;
  send(alert: FailureAlert, recipient: MaintenancePersonnel): Promise<void>;
}
