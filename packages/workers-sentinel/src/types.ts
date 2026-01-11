export interface Env {
	AUTH_STATE: DurableObjectNamespace;
	PROJECT_STATE: DurableObjectNamespace;
	ASSETS?: Fetcher;
}

// User types
export interface User {
	id: string;
	email: string;
	name: string;
	role: 'admin' | 'member';
	createdAt: string;
	updatedAt: string;
}

export interface Session {
	id: string;
	userId: string;
	expiresAt: string;
	createdAt: string;
}

// Project types
export interface Project {
	id: string;
	name: string;
	slug: string;
	platform: string;
	publicKey: string;
	createdAt: string;
	createdBy: string;
}

export interface ProjectMember {
	projectId: string;
	userId: string;
	role: 'owner' | 'admin' | 'member';
	createdAt: string;
}

// Issue types
export interface Issue {
	id: string;
	fingerprint: string;
	title: string;
	culprit: string | null;
	level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
	platform: string;
	firstSeen: string;
	lastSeen: string;
	count: number;
	userCount: number;
	status: 'unresolved' | 'resolved' | 'ignored';
	metadata: IssueMetadata;
}

export interface IssueMetadata {
	type: string;
	value: string;
	filename?: string;
	function?: string;
}

// Sentry event types
export interface SentryEvent {
	event_id: string;
	timestamp: string;
	platform: string;
	level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
	logger?: string;
	transaction?: string;
	server_name?: string;
	release?: string;
	dist?: string;
	environment?: string;
	tags?: Record<string, string>;
	extra?: Record<string, unknown>;
	user?: EventUser;
	contexts?: Record<string, unknown>;
	request?: RequestContext;
	exception?: ExceptionInterface;
	breadcrumbs?: Breadcrumb[];
	sdk?: SdkInfo;
	fingerprint?: string[];
	message?: string;
}

export interface EventUser {
	id?: string;
	email?: string;
	ip_address?: string;
	username?: string;
}

export interface RequestContext {
	url?: string;
	method?: string;
	headers?: Record<string, string>;
	query_string?: string;
	data?: unknown;
	env?: Record<string, string>;
}

export interface ExceptionInterface {
	values: ExceptionValue[];
}

export interface ExceptionValue {
	type: string;
	value: string;
	module?: string;
	stacktrace?: Stacktrace;
	mechanism?: Mechanism;
}

export interface Stacktrace {
	frames: StackFrame[];
}

export interface StackFrame {
	filename?: string;
	function?: string;
	module?: string;
	lineno?: number;
	colno?: number;
	abs_path?: string;
	context_line?: string;
	pre_context?: string[];
	post_context?: string[];
	in_app?: boolean;
}

export interface Mechanism {
	type: string;
	handled?: boolean;
	synthetic?: boolean;
}

export interface Breadcrumb {
	type?: string;
	category?: string;
	message?: string;
	data?: Record<string, unknown>;
	level?: string;
	timestamp?: string;
}

export interface SdkInfo {
	name: string;
	version: string;
	integrations?: string[];
	packages?: Array<{ name: string; version: string }>;
}

// Envelope types
export interface EnvelopeHeader {
	event_id?: string;
	dsn?: string;
	sdk?: SdkInfo;
	sent_at?: string;
}

export interface EnvelopeItem {
	type: 'event' | 'session' | 'attachment' | 'transaction' | 'client_report';
	payload: unknown;
}

export interface ParsedEnvelope {
	header: EnvelopeHeader;
	items: EnvelopeItem[];
}

// API types
export interface ApiError {
	error: string;
	message: string;
	status: number;
}

export interface PaginatedResponse<T> {
	data: T[];
	nextCursor?: string;
	hasMore: boolean;
}

// Hono context types
export interface AuthContext {
	user: User;
	session: Session;
}
