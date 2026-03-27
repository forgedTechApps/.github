# ═══════════════════════════════════════════════════════════════════════════════
# PER-PRODUCT CI FILES
# ═══════════════════════════════════════════════════════════════════════════════
#
# Each product repo only needs this thin wrapper.
# All quality gate logic lives in the .github org repo.
# Update the central workflows once — all products get the change automatically.
#
# Replace forgedTech with your GitHub organisation slug everywhere.
# ═══════════════════════════════════════════════════════════════════════════════


# ───────────────────────────────────────────────────────────────────────────────
# forge-pipe-mcp / Alula / NetworkPulse
# .github/workflows/ci.yml  (TypeScript / Node.js)
# ───────────────────────────────────────────────────────────────────────────────
#
# name: CI
#
# on:
#   push:
#     branches: ['**']
#   pull_request:
#     branches: [main]
#
# concurrency:
#   group: ci-${{ github.ref }}
#   cancel-in-progress: true
#
# jobs:
#   quality-gate:
#     uses: forgedTech/.github/.github/workflows/reusable-quality-gate-node.yml@main
#     with:
#       node-version: '20'
#       coverage-threshold: '80'
#     secrets: inherit
#
#   regression:
#     uses: forgedTech/.github/.github/workflows/reusable-quality-gate-node.yml@main
#     needs: quality-gate
#     # Only run regression on main and PRs to main
#     if: github.ref == 'refs/heads/main' || github.base_ref == 'main'
#     with:
#       node-version: '20'
#       test-command: 'npm run test:ci:regression'
#       build-command: 'echo "using artifact from quality-gate"'
#     secrets: inherit
#
#   deploy:
#     uses: forgedTech/.github/.github/workflows/reusable-deploy-railway.yml@main
#     needs: [quality-gate, regression]
#     if: github.ref == 'refs/heads/main' && github.event_name == 'push'
#     with:
#       service-name: 'forge-pipe-mcp'     # change per product
#       health-check-path: '/health'
#     secrets: inherit


# ───────────────────────────────────────────────────────────────────────────────
# eleven11
# .github/workflows/ci.yml  (Flutter / Dart)
# ───────────────────────────────────────────────────────────────────────────────
#
# name: CI
#
# on:
#   push:
#     branches: ['**']
#   pull_request:
#     branches: [main]
#
# concurrency:
#   group: ci-${{ github.ref }}
#   cancel-in-progress: true
#
# jobs:
#   quality-gate:
#     uses: forgedTech/.github/.github/workflows/reusable-quality-gate-flutter.yml@main
#     with:
#       flutter-version: '3.x'
#       coverage-threshold: '80'
#       build-android: true
#       build-ios: false       # set true on merge to main only (costs macOS minutes)
#     secrets: inherit


# ───────────────────────────────────────────────────────────────────────────────
# FORGE
# .github/workflows/ci.yml  (Swift / iOS)
# ───────────────────────────────────────────────────────────────────────────────
#
# name: CI
#
# on:
#   push:
#     branches: ['**']
#   pull_request:
#     branches: [main]
#
# concurrency:
#   group: ci-${{ github.ref }}
#   cancel-in-progress: true
#
# jobs:
#   quality-gate:
#     uses: forgedTech/.github/.github/workflows/reusable-quality-gate-swift.yml@main
#     with:
#       xcode-version: 'latest-stable'
#       scheme: 'FORGE'
#       destination: 'platform=iOS Simulator,name=iPhone 15,OS=latest'
#       coverage-threshold: '80'
#     secrets: inherit


# ───────────────────────────────────────────────────────────────────────────────
# Weekly security scan — add to EVERY product repo
# .github/workflows/security.yml
# ───────────────────────────────────────────────────────────────────────────────
#
# name: Security Scan
#
# on:
#   schedule:
#     - cron: '0 2 * * 0'    # Sunday 02:00 UTC
#   workflow_dispatch:
#
# jobs:
#   security-scan:
#     uses: forgedTech/.github/.github/workflows/reusable-security-scan.yml@main
#     with:
#       language: javascript-typescript    # change per product:
#       # Node.js:  javascript-typescript  # swift | python | csharp
#       enable-zap: false                  # true only for HTTP services
#       # zap-target-url: 'https://your-service.railway.app'
#     secrets: inherit
