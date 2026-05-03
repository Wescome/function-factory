import { NotificationService } from './notification-service';
import { ConsoleNotificationChannel } from './channels/console-channel';
import { PredictedFailure, MaintenancePersonnel } from './types';

describe('NotificationService', () => {
  let service: NotificationService;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    const channel = new ConsoleNotificationChannel();
    service = new NotificationService({ channels: [channel] });
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('sends alerts for predicted failures to maintenance personnel', async () => {
    const failure: PredictedFailure = {
      id: 'pf-001',
      componentId: 'cmp-001',
      componentName: 'Conveyor Belt Motor',
      predictedFailureDate: new Date('2024-06-15T00:00:00Z'),
      severity: 'high',
      confidence: 0.87,
      description: 'Vibration levels exceeding threshold',
    };

    const personnel: MaintenancePersonnel[] = [
      {
        id: 'mp-001',
        name: 'John Doe',
        email: 'john.doe@factory.local',
        roles: ['mechanic'],
        notificationPreferences: [{ channel: 'in_app', enabled: true }],
      },
    ];

    const alert = await service.notifyPredictedFailure(failure, personnel);

    expect(alert).toBeDefined();
    expect(alert.failure).toEqual(failure);
    expect(alert.recipients).toEqual(personnel);
    expect(alert.status).toBe('sent');
    expect(alert.message).toContain('Conveyor Belt Motor');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('john.doe@factory.local')
    );
  });

  it('marks alert as failed when channel delivery fails', async () => {
    const failingChannel: import('./notification-channel').NotificationChannel = {
      type: 'email',
      send: jest.fn().mockRejectedValue(new Error('SMTP error')),
    };

    const failingService = new NotificationService({ channels: [failingChannel] });

    const failure: PredictedFailure = {
      id: 'pf-002',
      componentId: 'cmp-002',
      componentName: 'Hydraulic Press',
      predictedFailureDate: new Date('2024-07-01T00:00:00Z'),
      severity: 'critical',
      confidence: 0.95,
      description: 'Pressure seal degradation detected',
    };

    const personnel: MaintenancePersonnel[] = [
      {
        id: 'mp-002',
        name: 'Jane Smith',
        email: 'jane.smith@factory.local',
        roles: ['supervisor'],
        notificationPreferences: [{ channel: 'email', enabled: true }],
      },
    ];

    const alert = await failingService.notifyPredictedFailure(failure, personnel);

    expect(alert.status).toBe('failed');
  });

  it('skips disabled notification preferences', async () => {
    const channel = new ConsoleNotificationChannel();
    const spy = jest.spyOn(channel, 'send').mockResolvedValue();
    const prefService = new NotificationService({ channels: [channel] });

    const failure: PredictedFailure = {
      id: 'pf-003',
      componentId: 'cmp-003',
      componentName: 'Cooling Fan',
      predictedFailureDate: new Date('2024-08-01T00:00:00Z'),
      severity: 'medium',
      confidence: 0.75,
      description: 'RPM fluctuation',
    };

    const personnel: MaintenancePersonnel[] = [
      {
        id: 'mp-003',
        name: 'Disabled User',
        email: 'disabled@factory.local',
        roles: ['mechanic'],
        notificationPreferences: [{ channel: 'in_app', enabled: false }],
      },
    ];

    await prefService.notifyPredictedFailure(failure, personnel);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
