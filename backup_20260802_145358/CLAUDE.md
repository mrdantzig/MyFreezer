# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This directory does not yet contain application code. It currently holds only:

- `.env` — stores the `OPENROUTER_API_KEY` environment variable for authenticating with the [OpenRouter](https://openrouter.ai) API. This is a **secret file**: never print its contents, commit it, or include it in generated code/logs. It is excluded via `.gitignore`.
- `.env.example` — a committable template showing the required variable name (`OPENROUTER_API_KEY=...`) without a real value. Copy this to `.env` and fill in the real key when setting up a new environment.
- `.gitignore` — excludes `.env` (and any other `*.env` file) from version control while still allowing `.env.example` to be committed.
- `OpenRouter Models.txt` — a list of OpenRouter model identifiers currently in use/under consideration:
  - `google/gemma-4-26b-a4b-it:free`
  - `cohere/north-mini-code:free`

## Working in this repo

- When code is added to this directory, it should load `OPENROUTER_API_KEY` from the environment (e.g. via a `.env`-loading library such as `dotenv`/`python-dotenv`) rather than hardcoding the key.
- Never read `.env` and echo/print its contents; never paste the key value into source files, commit messages, or docs.
- If a new environment needs the key, copy `.env.example` to `.env` and fill in the real value locally — do not commit `.env`.
- Use one of the model IDs from `OpenRouter Models.txt` when calling the OpenRouter API.
- This directory is not yet a git repository. Once `git init` is run, `.gitignore` is already in place to keep `.env` out of commits.

Update this file with real build/lint/test commands and architecture notes once source code exists.
