import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { OrgRole, Organization, OrganizationMember } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

// ─── Stub interface for NotificationsService ────────────────────────────────
// Same pattern as AuthService — injected as @Optional() to avoid coupling.

export interface INotificationsService {
  sendEmail(to: string, subject: string, body: string): Promise<void>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INVITE_EXPIRY_HOURS = 48;

// Vietnamese customer-friendly messages
const MSG = {
  SLUG_TAKEN: 'Slug này đã được sử dụng. Vui lòng chọn slug khác.',
  ORG_NOT_FOUND: 'Tổ chức không tồn tại hoặc bạn không có quyền truy cập.',
  FORBIDDEN_OWNER_ONLY: 'Chỉ chủ sở hữu (OWNER) mới có quyền thực hiện hành động này.',
  FORBIDDEN_OWNER_OR_ADMIN:
    'Bạn phải là chủ sở hữu (OWNER) hoặc quản trị viên (ADMIN) để thực hiện hành động này.',
  CANNOT_CHANGE_OWN_ROLE: 'Bạn không thể thay đổi vai trò của chính mình.',
  CANNOT_REMOVE_SELF_OWNER: 'Chủ sở hữu (OWNER) không thể tự xóa khỏi tổ chức.',
  MEMBER_ALREADY_EXISTS: 'Người dùng này đã là thành viên của tổ chức.',
  INVITE_TOKEN_INVALID: 'Lời mời không hợp lệ.',
  INVITE_EXPIRED: 'Lời mời này đã hết hạn. Vui lòng yêu cầu lời mời mới.',
} as const;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationsService?: INotificationsService,
  ) {}

  // ── Create ───────────────────────────────────────────────────────────────────

  /**
   * Creates a new organization and assigns the creator as OWNER.
   * Requirements: R2.1, R2.2
   */
  async create(userId: string, dto: CreateOrganizationDto): Promise<Organization> {
    // 1. Check slug uniqueness
    const existing = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(MSG.SLUG_TAKEN);
    }

    // 2. Create Organization + OrganizationMember (OWNER) in a transaction
    const org = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          logoUrl: dto.logoUrl ?? null,
        },
      });

      // 3. Create OrganizationMember with OWNER role, joinedAt = now
      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId,
          role: OrgRole.OWNER,
          joinedAt: new Date(),
        },
      });

      return organization;
    });

    return org;
  }

  // ── Find All For User ─────────────────────────────────────────────────────────

  /**
   * Returns all organizations where the user is a member (joinedAt not null).
   * Requirements: R2.3
   */
  async findAllForUser(userId: string): Promise<Organization[]> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId,
        joinedAt: { not: null },
      },
      select: { organizationId: true },
    });

    const orgIds = memberships.map((m) => m.organizationId);

    if (orgIds.length === 0) {
      return [];
    }

    return this.prisma.organization.findMany({
      where: {
        id: { in: orgIds },
        deletedAt: null,
      },
    });
  }

  // ── Find By Id ────────────────────────────────────────────────────────────────

  /**
   * Returns an organization by ID.
   * SECURITY: Returns 404 for both "not found" and "user not member" — prevents enumeration.
   * Requirements: R2.5, R22.3
   */
  async findById(orgId: string, userId: string): Promise<Organization> {
    // Verify user is a member of this org
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
      select: { joinedAt: true },
    });

    // Return 404 regardless of reason (not found or not member) — no info leakage
    if (!membership || membership.joinedAt === null) {
      throw new NotFoundException(MSG.ORG_NOT_FOUND);
    }

    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
    });

    if (!org) {
      throw new NotFoundException(MSG.ORG_NOT_FOUND);
    }

    return org;
  }

  // ── Update ────────────────────────────────────────────────────────────────────

  /**
   * Updates an organization. Requires OWNER or ADMIN role.
   * Requirements: R2.4
   */
  async update(
    orgId: string,
    userId: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    // Verify OWNER or ADMIN
    await this.requireRole(orgId, userId, [OrgRole.OWNER, OrgRole.ADMIN]);

    // If changing slug, check uniqueness
    if (dto.slug) {
      const existing = await this.prisma.organization.findFirst({
        where: { slug: dto.slug, id: { not: orgId } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(MSG.SLUG_TAKEN);
      }
    }

    return this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
      },
    });
  }

  // ── Soft Delete ───────────────────────────────────────────────────────────────

  /**
   * Soft deletes an organization (sets deletedAt). OWNER role required.
   * Requirements: R2.6
   */
  async softDelete(orgId: string, userId: string): Promise<void> {
    await this.requireRole(orgId, userId, [OrgRole.OWNER]);

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { deletedAt: new Date() },
    });
  }

  // ── Invite Member ─────────────────────────────────────────────────────────────

  /**
   * Invites a member to the organization.
   * Email send is fire-and-forget — failure does NOT roll back the invite.
   * Requirements: R2.7
   */
  async inviteMember(
    orgId: string,
    inviterId: string,
    dto: InviteMemberDto,
  ): Promise<void> {
    // Verify inviter is OWNER or ADMIN
    await this.requireRole(orgId, inviterId, [OrgRole.OWNER, OrgRole.ADMIN]);

    // Find target user by email
    const targetUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, email: true, name: true },
    });

    if (targetUser) {
      // Check if already a member
      const existingMembership = await this.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: targetUser.id,
          },
        },
        select: { id: true, joinedAt: true },
      });

      if (existingMembership && existingMembership.joinedAt !== null) {
        throw new ConflictException(MSG.MEMBER_ALREADY_EXISTS);
      }

      // If there's a pending invite already, update it; otherwise create
      if (existingMembership) {
        const inviteToken = uuidv4();
        const inviteExpiry = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

        await this.prisma.organizationMember.update({
          where: { id: existingMembership.id },
          data: {
            role: dto.role,
            inviteToken,
            inviteExpiry,
            invitedBy: inviterId,
          },
        });

        // Fire-and-forget email
        this.sendInvitationEmail(dto.email, orgId, inviteToken).catch((err) => {
          this.logger.warn(`Failed to send invitation email to ${dto.email}: ${String(err)}`);
        });

        return;
      }
    }

    const inviteToken = uuidv4();
    const inviteExpiry = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

    // Create OrganizationMember with pending invite (joinedAt = null)
    await this.prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: targetUser?.id ?? uuidv4(), // placeholder if user doesn't exist yet
        role: dto.role,
        invitedBy: inviterId,
        inviteToken,
        inviteExpiry,
        joinedAt: null,
      },
    });

    // Log to ActivityLog
    await this.logActivity({
      organizationId: orgId,
      eventType: 'APPROVAL_DECISION',
      friendlyMessage: `Đã gửi lời mời tham gia tổ chức đến ${dto.email} với vai trò ${dto.role}.`,
      actorId: inviterId,
    });

    // Fire-and-forget invitation email
    this.sendInvitationEmail(dto.email, orgId, inviteToken).catch((err) => {
      this.logger.warn(`Failed to send invitation email to ${dto.email}: ${String(err)}`);
    });
  }

  // ── Accept Invite ─────────────────────────────────────────────────────────────

  /**
   * Accepts a membership invitation by token.
   * Requirements: R2.8
   */
  async acceptInvite(token: string, userId: string): Promise<void> {
    // Find pending invitation by token
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        inviteToken: token,
        joinedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        inviteExpiry: true,
        role: true,
      },
    });

    if (!membership) {
      throw new BadRequestException(MSG.INVITE_TOKEN_INVALID);
    }

    // Check expiry
    if (!membership.inviteExpiry || membership.inviteExpiry < new Date()) {
      throw new BadRequestException(MSG.INVITE_EXPIRED);
    }

    // Accept: set joinedAt, clear token/expiry, update userId to actual user
    await this.prisma.organizationMember.update({
      where: { id: membership.id },
      data: {
        userId,
        joinedAt: new Date(),
        inviteToken: null,
        inviteExpiry: null,
      },
    });

    // Log to ActivityLog
    await this.logActivity({
      organizationId: membership.organizationId,
      eventType: 'APPROVAL_DECISION',
      friendlyMessage: `Thành viên mới đã chấp nhận lời mời và tham gia tổ chức với vai trò ${membership.role}.`,
      actorId: userId,
    });
  }

  // ── Get Members ───────────────────────────────────────────────────────────────

  /**
   * Returns all members of an organization. User must be a member.
   * Requirements: R2.3, R22.3
   */
  async getMembers(
    orgId: string,
    userId: string,
  ): Promise<(OrganizationMember & { user: { id: string; email: string; name: string | null; avatarUrl: string | null } })[]> {
    // Verify user is a member
    await this.requireMembership(orgId, userId);

    return this.prisma.organizationMember.findMany({
      where: {
        organizationId: orgId,
        joinedAt: { not: null },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    }) as Promise<(OrganizationMember & { user: { id: string; email: string; name: string | null; avatarUrl: string | null } })[]>;
  }

  // ── Update Member Role ────────────────────────────────────────────────────────

  /**
   * Updates the role of a member. Only OWNER can change roles.
   * Requirements: R2.5
   */
  async updateMemberRole(
    orgId: string,
    targetUserId: string,
    requesterId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<void> {
    // Verify requester is OWNER
    await this.requireRole(orgId, requesterId, [OrgRole.OWNER]);

    // Cannot change own role
    if (targetUserId === requesterId) {
      throw new BadRequestException(MSG.CANNOT_CHANGE_OWN_ROLE);
    }

    // Verify target is a member of this org
    const targetMembership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: targetUserId },
      },
      select: { id: true, role: true, joinedAt: true },
    });

    if (!targetMembership || targetMembership.joinedAt === null) {
      throw new NotFoundException(MSG.ORG_NOT_FOUND);
    }

    const oldRole = targetMembership.role;

    await this.prisma.organizationMember.update({
      where: { id: targetMembership.id },
      data: { role: dto.role },
    });

    // Log to ActivityLog
    await this.logActivity({
      organizationId: orgId,
      eventType: 'APPROVAL_DECISION',
      friendlyMessage: `Vai trò của thành viên đã được thay đổi từ ${oldRole} thành ${dto.role}.`,
      actorId: requesterId,
    });
  }

  // ── Remove Member ─────────────────────────────────────────────────────────────

  /**
   * Removes a member from the organization. OWNER or ADMIN required.
   * OWNER cannot remove themselves.
   * Requirements: R2.6
   */
  async removeMember(
    orgId: string,
    targetUserId: string,
    requesterId: string,
  ): Promise<void> {
    // Verify requester is OWNER or ADMIN
    const requesterMembership = await this.requireRole(orgId, requesterId, [
      OrgRole.OWNER,
      OrgRole.ADMIN,
    ]);

    // OWNER cannot remove themselves
    if (
      targetUserId === requesterId &&
      requesterMembership.role === OrgRole.OWNER
    ) {
      throw new BadRequestException(MSG.CANNOT_REMOVE_SELF_OWNER);
    }

    // Verify target membership exists and is active — scoped to this org
    const targetMembership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: targetUserId },
      },
      select: { id: true, joinedAt: true },
    });

    if (!targetMembership || targetMembership.joinedAt === null) {
      throw new NotFoundException(MSG.ORG_NOT_FOUND);
    }

    // Hard delete the membership record
    await this.prisma.organizationMember.delete({
      where: { id: targetMembership.id },
    });

    // Log to ActivityLog
    await this.logActivity({
      organizationId: orgId,
      eventType: 'APPROVAL_DECISION',
      friendlyMessage: `Một thành viên đã bị xóa khỏi tổ chức.`,
      actorId: requesterId,
    });
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  /**
   * Asserts user has one of the required roles in the organization.
   * Returns the membership record on success.
   * Throws ForbiddenException with appropriate message on failure.
   * NOTE: Uses SAME NotFoundException for "org not found" vs "not member" — no enumeration.
   */
  private async requireRole(
    orgId: string,
    userId: string,
    allowedRoles: OrgRole[],
  ): Promise<{ role: OrgRole }> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
      select: { role: true, joinedAt: true },
    });

    if (!membership || membership.joinedAt === null) {
      throw new NotFoundException(MSG.ORG_NOT_FOUND);
    }

    if (!allowedRoles.includes(membership.role)) {
      const isOwnerOnly = allowedRoles.length === 1 && allowedRoles[0] === OrgRole.OWNER;
      throw new ForbiddenException(
        isOwnerOnly ? MSG.FORBIDDEN_OWNER_ONLY : MSG.FORBIDDEN_OWNER_OR_ADMIN,
      );
    }

    return { role: membership.role };
  }

  /**
   * Asserts user is an active member of the organization.
   * Throws NotFoundException with same error for both "not found" and "not member".
   */
  private async requireMembership(orgId: string, userId: string): Promise<void> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
      select: { joinedAt: true },
    });

    if (!membership || membership.joinedAt === null) {
      throw new NotFoundException(MSG.ORG_NOT_FOUND);
    }
  }

  /**
   * Logs an event to ActivityLog. Always includes organizationId.
   * Requirements: R22.3
   */
  private async logActivity(params: {
    organizationId: string;
    eventType: 'APPROVAL_DECISION';
    friendlyMessage: string;
    actorId: string;
    projectId?: string;
    issueId?: string;
    taskId?: string;
  }): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          organizationId: params.organizationId,
          eventType: params.eventType,
          friendlyMessage: params.friendlyMessage,
          actorId: params.actorId,
          projectId: params.projectId ?? null,
          issueId: params.issueId ?? null,
          taskId: params.taskId ?? null,
          createdAt: new Date(),
        },
      });
    } catch (err) {
      // Log failure should not break the main operation
      this.logger.warn(`Failed to write ActivityLog: ${String(err)}`);
    }
  }

  /**
   * Sends an invitation email. Fire-and-forget — caller handles rejection.
   */
  private async sendInvitationEmail(
    email: string,
    orgId: string,
    inviteToken: string,
  ): Promise<void> {
    if (!this.notificationsService) return;

    await this.notificationsService.sendEmail(
      email,
      'Bạn được mời tham gia tổ chức',
      `Bạn đã được mời tham gia một tổ chức. Vui lòng nhấp vào liên kết sau để chấp nhận lời mời: /invite/accept?token=${inviteToken}\n\nLời mời có hiệu lực trong ${INVITE_EXPIRY_HOURS} giờ.`,
    );
  }
}
