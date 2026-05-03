/**
 * Client interface for seamless communication with maintenance scheduling systems.
 * Implementations should handle protocol translation and error mapping.
 */

import { MaintenanceSchedulingConnectionConfig } from './config';
import {
  MaintenanceTask,
  ScheduleResponse,
  MaintenanceWindow,
} from './types';

export interface MaintenanceSchedulingClient {
  /** Runtime configuration for the connected scheduling system */
  readonly config: MaintenanceSchedulingConnectionConfig;

  /** Initialize the connection to the scheduling system */
  connect(): Promise<void>;

  /** Gracefully terminate the connection */
  disconnect(): Promise<void>;

  /** Indicates whether the client has an active connection */
  isConnected(): boolean;

  /** Submit a maintenance task to be scheduled */
  scheduleMaintenance(task: MaintenanceTask): Promise<ScheduleResponse>;

  /** Retrieve the current maintenance window for a specific equipment unit */
  getMaintenanceWindow(equipmentId: string): Promise<MaintenanceWindow>;

  /** Cancel an existing maintenance schedule by its system identifier */
  cancelMaintenance(scheduleId: string): Promise<void>;

  /** Perform a bi-directional sync of all pending/completed schedules */
  syncSchedules(): Promise<ScheduleResponse[]>;
}
