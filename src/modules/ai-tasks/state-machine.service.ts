import { BadRequestException, Injectable } from '@nestjs/common';
import { AITaskStatus } from '@prisma/client';

export const VALID_TRANSITIONS: Record<AITaskStatus, AITaskStatus[]> = {
  QUEUED:           ['ANALYZING', 'PREPARING', 'WAITING_APPROVAL', 'CANCELLED', 'FAILED'],
  ANALYZING:        ['PLANNING', 'FAILED', 'CANCELLED'],
  PLANNING:         ['WAITING_APPROVAL', 'FAILED'],
  WAITING_APPROVAL: ['APPROVED', 'PREPARING', 'QUEUED', 'CANCELLED'],
  APPROVED:         ['PREPARING', 'FAILED'],
  PREPARING:        ['CODING', 'FAILED'],
  CODING:           ['TESTING', 'FAILED'],
  TESTING:          ['REVIEWING', 'FIXING', 'FAILED'],
  FIXING:           ['TESTING', 'FAILED'],
  REVIEWING:        ['CREATING_PR', 'FAILED'],
  CREATING_PR:      ['COMPLETED', 'FAILED'],
  COMPLETED:        [],      // Terminal
  FAILED:           [],      // Terminal
  CANCELLED:        [],      // Terminal
};

// Customer-friendly messages for each terminal/failure state
const FAILURE_MESSAGES: Partial<Record<AITaskStatus, string>> = {
  FAILED: 'Tác vụ AI đã thất bại. Vui lòng kiểm tra mô tả và thử lại, hoặc liên hệ hỗ trợ.',
  CANCELLED: 'Tác vụ AI đã bị hủy.',
};

@Injectable()
export class StateMachineService {
  /**
   * Validates that a transition from `fromStatus` to `toStatus` is allowed.
   * Throws BadRequestException with Vietnamese message if transition is invalid.
   * Does NOT modify the database.
   */
  assertValidTransition(fromStatus: AITaskStatus, toStatus: AITaskStatus): void {
    const allowed = VALID_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(
        `Không thể chuyển trạng thái từ ${fromStatus} sang ${toStatus}. Chuyển tiếp không hợp lệ.`,
      );
    }
  }

  /**
   * Returns true if the transition is valid, false otherwise.
   */
  canTransitionTo(fromStatus: AITaskStatus, toStatus: AITaskStatus): boolean {
    const allowed = VALID_TRANSITIONS[fromStatus] ?? [];
    return allowed.includes(toStatus);
  }

  /**
   * Returns the customer-friendly failure message for a given final state.
   */
  getFailureMessage(status: AITaskStatus): string {
    return FAILURE_MESSAGES[status] ?? 'Tác vụ đã kết thúc.';
  }
}
