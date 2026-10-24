# gh-refs

Hover cards for GitHub issues and pull requests in Claude Code.

When a Claude reply mentions an issue or PR, a row of small chips appears under it, one per reference, colored by state. Hover a chip to see:

- the title
- issue or PR, open / closed / merged / draft / not planned, and the milestone
- labels
- the parent theme: the parent issue labelled `theme` (or its parent), otherwise the plain parent issue
- a one- or two-line summary of the body (its Summary section if it has one, else its first paragraph)

It works in the Claude desktop app's Code tab and in the terminal (fullscreen mode). Phones have no hover; the colored chips still show there.

## What it recognizes

- Full links: `https://github.com/owner/repo/issues/43`, `.../pull/202`
- `owner/repo#43`
- A bare `#43`. It means the repository the same reply last named in full, else the **Default repository** setting, else the GitHub repository of the folder Claude runs in. With none of those, a bare `#43` is skipped.

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`), signed in (`gh auth login`). Cards show what your account can read, private repositories included.

## Install

At the prompt of a terminal session:

```
/plugin install gh-refs --marketplace abmorrill4/gh-refs
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session.

From a shell:

```bash
claude plugin install gh-refs --marketplace abmorrill4/gh-refs
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `abmorrill4/gh-refs`, then **Add plugin**.

Installed at the user scope, it loads by itself in every new session, the desktop app's included.

## Settings

| Setting | What it does |
| --- | --- |
| Default repository | `owner/repo` that a bare `#123` points to when a reply names no repository. Empty: the GitHub repository of the folder Claude runs in. |

Change it in `/config`, or in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "gh-refs@gh-refs": { "options": { "defaultRepo": "owner/repo" } } } }
```

## How it works

Claude Code draws a reply's text as one block a plugin cannot reach inside, so the hover sits on chips under the reply rather than on the link itself. Hover reveals are pure styling with no code running on hover, so the details are fetched as soon as the reply is drawn: one `gh api graphql` call per batch, for every repository at once, kept for five minutes.

## Remove

```bash
claude plugin uninstall gh-refs
```

## Develop

```bash
claude plugin validate .
claude plugin test .
```

## License

[MIT](LICENSE)
