export type NotificationChannelType = 'email' | 'sms' | 'in_app' | 'push';

export interface NotificationPreference {
  channel: NotificationChannelType;
  enabled: boolean;
}

export interface MaintenancePersonnel {
  id: string;
  name: string;
  email: string;
  phone?: string;
  roles: string[];
  notificationPreferences: NotificationPreference[];
}

export type FailureSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface PredictedFailure {
  id: string;
  componentId: string;
  componentName: string;
  predictedFailureDate: Date;
  severity: FailureSeverity;
  confidence: number;
  description: string;
}

export interface FailureAlert {
  id: string;
  failure: PredictedFailure;
  recipients: MaintenancePersonnel[];
  message: string;
  timestamp: Date;
  status: 'pending' | 'sent' | 'failed';
}
