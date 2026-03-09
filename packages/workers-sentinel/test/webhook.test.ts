import { describe, expect, it } from 'vitest';
import { buildWebhookPayload } from '../src/lib/webhook';

describe('Webhook Utility', () => {
	const testProject = { id: 'proj-1', name: 'My App', slug: 'my-app' };

	describe('buildWebhookPayload', () => {
		it('should build correct payload for error level', () => {
			const payload = buildWebhookPayload(testProject, {
				id: 'issue-1',
				title: 'TypeError: Cannot read property',
				level: 'error',
				culprit: 'app.js in handleClick',
			});

			expect(payload.text).toContain('[My App]');
			expect(payload.text).toContain('New error');
			expect(payload.text).toContain('TypeError: Cannot read property');
			expect(payload.text).toContain('in app.js in handleClick');
			expect(payload.project).toEqual(testProject);
			expect(payload.issue.id).toBe('issue-1');
			expect(payload.issue.level).toBe('error');
			expect(payload.timestamp).toBeDefined();
		});

		it('should build correct payload for fatal level', () => {
			const payload = buildWebhookPayload(testProject, {
				id: 'issue-2',
				title: 'Process crashed',
				level: 'fatal',
				culprit: null,
			});

			expect(payload.text).toContain('New fatal');
			expect(payload.text).not.toContain(' in ');
			expect(payload.issue.culprit).toBeNull();
		});

		it('should build correct payload for warning level', () => {
			const payload = buildWebhookPayload(testProject, {
				id: 'issue-3',
				title: 'Deprecated API used',
				level: 'warning',
				culprit: null,
			});

			expect(payload.text).toContain('New warning');
		});

		it('should build correct payload for info level', () => {
			const payload = buildWebhookPayload(testProject, {
				id: 'issue-4',
				title: 'User signed up',
				level: 'info',
				culprit: null,
			});

			expect(payload.text).toContain('New info');
		});

		it('should build correct payload for debug level', () => {
			const payload = buildWebhookPayload(testProject, {
				id: 'issue-5',
				title: 'Debug message',
				level: 'debug',
				culprit: null,
			});

			expect(payload.text).toContain('New debug');
		});

		it('should use default emoji for unknown level', () => {
			const payload = buildWebhookPayload(testProject, {
				id: 'issue-6',
				title: 'Unknown level event',
				level: 'custom',
				culprit: null,
			});

			// Should still build without error
			expect(payload.text).toContain('New custom');
			expect(payload.issue.level).toBe('custom');
		});

		it('should include timestamp in ISO format', () => {
			const before = new Date().toISOString();
			const payload = buildWebhookPayload(testProject, {
				id: 'issue-7',
				title: 'Test',
				level: 'error',
				culprit: null,
			});
			const after = new Date().toISOString();

			expect(payload.timestamp >= before).toBe(true);
			expect(payload.timestamp <= after).toBe(true);
		});
	});
});
