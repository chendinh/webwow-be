export interface ProjectAnalysisJobData {
  projectId: string;
  organizationId: string;
  githubInstallationId: string;
  repoFullName: string;
  branch: string;
}

export interface AIAnalysisJobData {
  issueId: string;
  projectId: string;
  organizationId: string;
  retryCount: number;
  /** When true: skip AnalysisAgent, use existing analysis result, run PlanningAgent only */
  planningOnly?: boolean;
}

export interface AICodingJobData {
  taskId: string;
  issueId: string;
  projectId: string;
  organizationId: string;
}

export interface PRCreationJobData {
  taskId: string;
  issueId: string;
  projectId: string;
  organizationId: string;
  branchName: string;
}

export interface NotificationJobData {
  to: string;
  subject: string;
  body: string;
  organizationId: string;
}

export interface HealthCheckJobData {
  projectId: string;
  organizationId: string;
  repoFullName: string;
  branch: string;
  githubInstallationId: string;
}
