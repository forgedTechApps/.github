---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

If independent tasks are available and subagents are appropriate, prefer `subagent-driven-development` for parallel execution within the same session.

## The Process

### Step 1: Load and Review Plan

1. Read the plan file
2. Review critically — identify any questions or concerns
3. If concerns: raise them before starting
4. If no concerns: create todos for the plan items and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

### Step 3: Complete Development

After all tasks complete and verified, invoke `finishing-a-development-branch`.

## When to Stop and Ask for Help

**Stop immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

Ask for clarification rather than guessing.

## Remember

- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Stop when blocked, don't guess
- Never start implementation on main/dev branch — work on a feature branch
