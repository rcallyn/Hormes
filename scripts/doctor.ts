#!/usr/bin/env tsx
import { render, runChecks } from "@hormes/cli";

const { text, blocking } = render(await runChecks());
console.log(text);
process.exit(blocking > 0 ? 1 : 0);
