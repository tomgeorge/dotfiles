---
name: approve-pr
description: Approve a GitHub pull request with the user's signature rocket-frog image as the review body. Use whenever the user asks to approve, LGTM, ship, or stamp a PR (by URL, number, or the current branch's PR).
argument-hint: <pr-url-or-number>
---

# Approve PR

1. Resolve the PR from a URL, `owner/repo#123`, a number (current repo), or nothing (the current branch's PR):

   ```bash
   gh pr view <pr> --json url,state,author,title --jq '{url,state,author:.author.login,title}'
   ```

   Stop and tell the user if it isn't open, or if they wrote it (`gh api user --jq .login`), since GitHub rejects self-approval.

2. Approve it with the image as the body. Put any text the user supplied on a line above the image:

   ```bash
   gh pr review <pr> --approve --body '![rocket-frog](https://github.com/user-attachments/assets/eacbe96a-fe74-4b61-9fc8-a56a46f898fc)'
   ```

3. Report the PR URL. Don't merge or do anything else.

The image renders only for viewers with access to the private repo it was uploaded from, so it may look broken on public repos. If the link stops working, `rocket-frog.png` next to this file is the original: tell the user to re-upload it to a GitHub comment and update the URL here and in `~/.pi/agent/prompts/review-loop.md`.
