# Contributing to AmiSafe

Thank you for contributing. Please read this document before opening a pull request.

## Getting started

1. Fork the repo and clone your fork
2. Follow the Quick Start in `README.md`
3. Pick an issue labelled `good first issue` or `help wanted`
4. Create a branch: `git checkout -b feat/your-feature-name`

## Commit style

Use conventional commits:

```
feat:     new feature
fix:      bug fix
docs:     documentation only
refactor: code restructure, no behaviour change
test:     add or fix tests
chore:    build, deps, config
```

Examples:
- `feat(extension): add Somali locale strings`
- `fix(api): prevent double-submission on retry`
- `docs: update privacy architecture diagram`

## Pull request checklist

- [ ] Code follows existing style (no new linting errors)
- [ ] New features include tests
- [ ] Privacy implications considered and documented
- [ ] No secrets or `.env` values committed
- [ ] ETHICS.md principles upheld

## Adding a language

1. Copy `extension/_locales/en/messages.json` to `extension/_locales/<lang>/messages.json`
2. Translate all `message` values (keep keys unchanged)
3. Add the language code to `shared/harm-taxonomy.json` → `supportedLanguages`
4. Add translations for each category in `shared/harm-taxonomy.json`
5. Add the option to `extension/popup/popup.html` → `#langSelect`
6. Add the mapping in `bot/src/handlers/report-flow.js` → `LANG_MAP`

## Reporting security issues

Do **not** open a public issue. Email security@amisafe.org with details.
We aim to respond within 48 hours.

## Licence

By contributing, you agree that your contributions will be licensed under Apache 2.0.
