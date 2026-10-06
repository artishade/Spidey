# Contributing

Start with the local playground at http://127.0.0.1:8787/spider-demo. Real X markup changes frequently; extraction improvements should include a sanitized synthetic fixture, not private account content.

```sh
npm ci --ignore-scripts
python3 -m unittest discover -s tests -v
npm test
python3 scripts/package_extension.py
```

Never use live credentials or broadcast Solana transactions in tests. Keep new browser permissions minimal and explain any added permissions in the PR. Grok behavior must remain optional and mocked in CI. Keep uncertainty visible in the product; do not turn missing evidence into a pass.

Files to know: extension/shared.js (post extraction), extension/spider-ui.js (spider), jev.py (signals), grok.py (reviewers), app.py (HTTP and crawler), automation.py and launch/ (optional launch engine).
