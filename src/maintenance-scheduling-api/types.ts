/**
 * Core domain types for maintenance scheduling integration.
 */

export interface MaintenanceTask {
  /** Unique identifier for the task within the local system */
  id: string;

  /** Identifier of the equipment requiring maintenance */
  equipmentId: string;

  /** Human-readable description of the required work */
  description: string;

  /** Priority level affecting scheduling precedence */
  priority: 'low' | 'medium' | 'high' | 'critical';

  /** Preferred start time for the maintenance */
  requestedStartTime: Date;

  /** Estimated duration in minutes */
  estimatedDurationMinutes: number;

  /** Optional identifier of the assigned technician */
  assignedTechnicianId?: string;
}

export interface ScheduleResponse {
  /** System-generated schedule identifier */
  scheduleId: string;

  /** Current state of the scheduled task */
  status: 'pending' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled';

  /** Confirmed start time (if scheduled) */
  scheduledStartTime?: Date;

  /** Confirmed end time (if scheduled) */
  scheduledEndTime?: Date;

  /** Detected scheduling conflicts */
  conflicts?: ScheduleConflict[];
}

export interface ScheduleConflict {
  /** Identifier of the conflicting schedule entry */
  conflictingScheduleId: string;

  /** Explanation of the conflict */
  reason: string;

  /** Optional alternative time suggested by the scheduling system */
  suggestedAlternative?: Date;
}

export interface MaintenanceWindow {
  /** Equipment identifier */
  equipmentId: string;

  /** List of upcoming available time slots */
  availableSlots: TimeSlot[];

  /** Next planned maintenance date, if any */
  nextScheduledMaintenance?: Date;
}

export interface TimeSlot {
  startTime: Date;
  endTime: Date;
}
