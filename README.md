Unique Working Code Chunks: Thingamabob
This document extracts the specific, non-generic functional code chunks from the repository.

1. Automated Repository Logic Extraction & AI Auditing
File: src/App.tsx Function: Part of auditWithBuildTest

What it does: This chunk recursively maps a GitHub repository's tree, filters for logic-heavy files, fetches their content, and cleans them to build a dense context for AI analysis.

const treeRes = await ghFetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/git/trees/${repo.default_branch}?recursive=1`);
const treeData = await treeRes.json();
const allFiles = treeData.tree || [];
const logicFiles = allFiles.filter((f: any) => f.type === 'blob' && f.path.match(/\.(js|ts|jsx|tsx|py|go|json|yml|txt|md)$/)).sort((a: any, b: any) => b.size - a.size).slice(0, 15);
 
let context = `FILES:\n${allFiles.map((f: any) => f.path).slice(0, 50).join('\n')}\n\nCODE:`;
for (let f of logicFiles) {
  const fRes = await ghFetch(f.url);
  const fData = await fRes.json();
  const cleanContent = (fData.content || '').replace(/\s/g, '');
  context += `\n\n### ${f.path}\n${atob(cleanContent).substring(0, 3000)}\n---`;
}

2. AI-Driven README Evolution & Automated Commit
File: src/App.tsx Function: Part of auditWithBuildTest

What it does: Uses AI-generated insights to dynamically update a repository's README.md. It handles the SHA-based update flow required by the GitHub API.

const fileStatus = await fetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/README.md?ref=${repo.default_branch}`, { 
  headers: { 'Authorization': `token ${ghToken}` } 
});
const sha = fileStatus.ok ? (await fileStatus.json()).sha : null;
 
await ghFetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/README.md`, {
  method: 'PUT',
  body: JSON.stringify({ 
    message: 'docs: visual build audit by Balanced Auditor', 
    content: btoa(unescape(encodeURIComponent(finalReadme))), 
    sha, 
    branch: repo.default_branch 
  })
});

3. Global Code Search Scoping
File: src/App.tsx Function: performGlobalSearch

What it does: Programmatically determines the target scope for a GitHub code search, defaulting to the authenticated user if no target is provided.

let username = targetUser;
if (!username) {
  const userRes = await ghFetch('https://api.github.com/user');
  const userData = await userRes.json();
  username = userData.login;
}
 
const res = await ghFetch(`https://api.github.com/search/code?q=user:${username}+${globalSearchQuery}`);
const data = await res.json();

4. Custom Firestore Security Validation
File: firestore.rules

What it does: Implements a strict, custom validation logic for "Deployment" documents, ensuring data integrity beyond simple type checking.

function isValidDeployment(data) {
  return data.repoName is string && 
         data.repoName.size() > 0 &&
         data.status in ['PASS', 'FAIL'] &&
         data.timestamp is timestamp &&
         (!('maturity' in data) || data.maturity is string) &&
         (!('summary' in data) || data.summary is string) &&
         (!('uiUrl' in data) || (data.uiUrl is string && data.uiUrl.size() < 2000));
}

5. Robust API Error Recovery Wrapper
File: src/App.tsx Function: ghFetch

What it does: A specialized fetch wrapper that intercepts network failures and API error responses to provide actionable diagnostic information.

const ghFetch = async (url: string, options: RequestInit = {}) => {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `token ${ghToken}`,
        'Accept': 'application/vnd.github.v3+json',
        ...options.headers,
      },
    });
 
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`GitHub API Error [${response.status}]: ${errorData.message}`);
    }
 
    return response;
  } catch (e) {
    if (e instanceof Error && e.message.includes('Failed to fetch')) {
      throw new Error("Network Error: Failed to connect to GitHub. Check your internet connection or GitHub Token permissions.");
    }
    throw e;
  }
};
