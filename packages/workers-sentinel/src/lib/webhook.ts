export interface WebhookPayload {
	text: string;
	project: {
		id: string;
		name: string;
		slug: string;
	};
	issue: {
		id: string;
		title: string;
		level: string;
		culprit: string | null;
	};
	timestamp: string;
}

export function buildWebhookPayload(
	project: { id: string; name: string; slug: string },
	issue: { id: string; title: string; level: string; culprit: string | null },
): WebhookPayload {
	const levelEmoji: Record<string, string> = {
		fatal: '\u{1F480}',
		error: '\u{1F6A8}',
		warning: '\u26A0\uFE0F',
		info: '\u2139\uFE0F',
		debug: '\u{1F50D}',
	};
	const emoji = levelEmoji[issue.level] || '\u{1F6A8}';
	const culpritText = issue.culprit ? ` in ${issue.culprit}` : '';

	return {
		text: `${emoji} [${project.name}] New ${issue.level}: ${issue.title}${culpritText}`,
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug,
		},
		issue: {
			id: issue.id,
			title: issue.title,
			level: issue.level,
			culprit: issue.culprit,
		},
		timestamp: new Date().toISOString(),
	};
}

export async function sendWebhook(url: string, payload: WebhookPayload): Promise<void> {
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (!response.ok) {
			const body = await response.text();
			console.error(`Webhook delivery failed: ${response.status} ${response.statusText} - ${body}`);
		} else {
			await response.body?.cancel();
		}
	} catch (error) {
		console.error('Webhook delivery error:', error);
	}
}
