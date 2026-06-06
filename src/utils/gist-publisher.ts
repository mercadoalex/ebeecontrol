/**
 * GitHub Gist Publisher — Uploads forensic reports as public Gists
 * so they can be linked from the Dynatrace dashboard.
 */

export interface GistResult {
  url: string;
  id: string;
}

/**
 * Creates a public GitHub Gist with the given content.
 * Returns the Gist URL for embedding in the dashboard.
 */
export async function publishToGist(
  title: string,
  content: string,
  token: string
): Promise<GistResult> {
  const filename = `${title.replace(/[^a-zA-Z0-9-_]/g, '-')}.md`;

  const response = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
    },
    body: JSON.stringify({
      description: `🐝 eBeeControl Forensic Report — ${title}`,
      public: true,
      files: {
        [filename]: {
          content: `# 🐝 eBeeControl — Gemini AI Forensic Report\n\n**Generated:** ${new Date().toISOString()}\n\n---\n\n${content}`,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub Gist creation failed: ${response.status}`);
  }

  const data = await response.json() as { html_url: string; id: string };
  return { url: data.html_url, id: data.id };
}
