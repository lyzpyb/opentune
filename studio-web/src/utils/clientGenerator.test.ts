import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CLIENT_CONFIG } from '../types/client';
import { parseYtmUrl, validateClientConfig, hasValidationErrors, formatSeconds } from './ytmUrlParser';
import { generateClientProjectFiles } from './clientGenerator';
import {
  buildGitHubAuthorizeUrl,
  formatBytes,
  formatWorkflowStatusLabel,
  isValidGitHubBranch,
  isValidGitHubSegment,
  validateNewRepoName,
} from './githubHelpers';
import { collectStudioWorkspaceFiles, isAllowedWorkspaceFileName } from './workspaceCollector';

test('parseYtmUrl parses music.youtube.com watch URLs accurately', () => {
  const res = parseYtmUrl('https://music.youtube.com/watch?v=jfKfPfyJRdk&list=RDCLAK5uy_kset8DisdE7LSD4TNjEVvrKRTmG7a56sY');
  assert.equal(res.valid, true);
  assert.equal(res.kind, 'video');
  assert.equal(res.videoId, 'jfKfPfyJRdk');
  assert.equal(res.playlistId, 'RDCLAK5uy_kset8DisdE7LSD4TNjEVvrKRTmG7a56sY');
  assert.match(res.embedUrl ?? '', /^https:\/\/www\.youtube\.com\/embed\/jfKfPfyJRdk/);
});

test('parseYtmUrl supports youtu.be short links and playlist links', () => {
  const shortRes = parseYtmUrl('https://youtu.be/5qap5aO4i9A');
  assert.equal(shortRes.valid, true);
  assert.equal(shortRes.videoId, '5qap5aO4i9A');
  assert.equal(shortRes.normalizedUrl, 'https://music.youtube.com/watch?v=5qap5aO4i9A');

  const playlistRes = parseYtmUrl('https://music.youtube.com/playlist?list=PL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc');
  assert.equal(playlistRes.valid, true);
  assert.equal(playlistRes.kind, 'playlist');
  assert.equal(playlistRes.playlistId, 'PL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc');
});

test('parseYtmUrl rejects non-YouTube domains and malformed inputs', () => {
  const badDomain = parseYtmUrl('https://example.com/watch?v=jfKfPfyJRdk');
  assert.equal(badDomain.valid, false);
  assert.equal(badDomain.kind, 'invalid');

  const emptyInput = parseYtmUrl('   ');
  assert.equal(emptyInput.valid, false);
});

test('validateClientConfig passes default config and rejects invalid bundleId or non-https startUrl', () => {
  const okErrors = validateClientConfig(DEFAULT_CLIENT_CONFIG);
  assert.equal(hasValidationErrors(okErrors), false);

  const badErrors = validateClientConfig({
    ...DEFAULT_CLIENT_CONFIG,
    appName: '',
    bundleId: 'InvalidBundle',
    version: 'v1',
    startUrl: 'http://music.youtube.com',
    proxyServer: 'ftp://127.0.0.1:21',
  });
  assert.equal(hasValidationErrors(badErrors), true);
  assert.ok(badErrors.appName);
  assert.ok(badErrors.bundleId);
  assert.ok(badErrors.version);
  assert.ok(badErrors.startUrl);
  assert.ok(badErrors.proxyServer);
});

test('generateClientProjectFiles emits macOS DMG, Android APK, and GitHub Actions release workflow synced with config', () => {
  const customConfig = {
    ...DEFAULT_CLIENT_CONFIG,
    appName: 'MyMusic Pro',
    bundleId: 'com.studio.mymusic',
    version: '2.1.0',
    macArch: 'arm64' as const,
    proxyServer: 'http://127.0.0.1:7890',
    githubRepo: 'octocat/opentune',
  };

  const files = generateClientProjectFiles(customConfig);
  assert.ok(files.length >= 18);

  const macBuilder = files.find((f) => f.path === 'macos-electron/electron-builder.yml');
  assert.ok(macBuilder);
  assert.match(macBuilder.content, /appId: com\.studio\.mymusic/);
  assert.match(macBuilder.content, /productName: "MyMusic Pro"/);
  assert.match(macBuilder.content, /- arm64/);

  const macMain = files.find((f) => f.path === 'macos-electron/src/main.js');
  assert.ok(macMain);
  assert.match(macMain.content, /persist:ytmusic/);
  assert.match(macMain.content, /http:\/\/127\.0\.0\.1:7890/);
  assert.match(macMain.content, /MediaPlayPause/);
  assert.doesNotMatch(macMain.content, /Firefox\/132\.0/);
  assert.match(macMain.content, /startExternalBrowserLogin/);
  assert.match(macMain.content, /Storage\.getCookies/);
  assert.match(macMain.content, /openAuthWindow/);
  assert.match(macMain.content, /sec-ch-ua/);
  assert.match(macMain.content, /importCookiesFromClipboard/);
  assert.match(macMain.content, /powerSaveBlocker/);
  assert.match(macMain.content, /mediaKeySystem/);
  assert.match(macMain.content, /toggleTrayPopover/);
  assert.match(macMain.content, /isAllowedInAppUrl/);

  const macAuthHtml = files.find((f) => f.path === 'macos-electron/src/auth.html');
  assert.ok(macAuthHtml);
  assert.match(macAuthHtml.content, /startExternalBrowser/);
  assert.match(macAuthHtml.content, /openDefaultBrowser/);

  const macAuthPreload = files.find((f) => f.path === 'macos-electron/src/auth-preload.js');
  assert.ok(macAuthPreload);
  assert.match(macAuthPreload.content, /ytmAuthBridge/);

  const macTrayHtml = files.find((f) => f.path === 'macos-electron/src/tray.html');
  assert.ok(macTrayHtml);
  assert.match(macTrayHtml.content, /volumeSlider/);
  assert.match(macTrayHtml.content, /coverImg/);

  const macPreload = files.find((f) => f.path === 'macos-electron/src/preload.js');
  assert.ok(macPreload);
  assert.match(macPreload.content, /ytm-native-nav-host/);
  assert.match(macPreload.content, /dismissIdlePromptAndRecover/);

  const androidMain = files.find((f) => f.path === 'android-webview/app/src/main/java/com/studio/mymusic/MainActivity.kt');
  assert.ok(androidMain);
  assert.match(androidMain.content, /package com\.studio\.mymusic/);
  assert.doesNotMatch(androidMain.content, /Firefox\/132\.0/);
  assert.match(androidMain.content, /openExternalBrowserLogin/);
  assert.match(androidMain.content, /setRequestedWithHeaderOriginAllowList/);
  assert.match(androidMain.content, /showCookieImportDialog/);
  assert.match(androidMain.content, /setAcceptThirdPartyCookies/);
  assert.match(androidMain.content, /RESOURCE_PROTECTED_MEDIA_ID/);
  assert.match(androidMain.content, /floatingNavBar/);

  const androidService = files.find((f) => f.path === 'android-webview/app/src/main/java/com/studio/mymusic/MediaPlaybackService.kt');
  assert.ok(androidService);
  assert.match(androidService.content, /FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK/);

  const ciWorkflow = files.find((f) => f.path === '.github/workflows/build-clients.yml');
  assert.ok(ciWorkflow);
  assert.match(ciWorkflow.content, /runs-on: macos-latest/);
  assert.match(ciWorkflow.content, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(ciWorkflow.content, /gradle assembleRelease/);
  assert.match(ciWorkflow.content, /softprops\/action-gh-release@v2/);
  assert.match(ciWorkflow.content, /contents: write/);

  const readme = files.find((f) => f.path === 'README.md');
  assert.ok(readme);
  assert.match(readme.content, /img\.shields\.io\/github\/v\/release\/octocat\/opentune/);
  assert.match(readme.content, /xattr -cr/);

  const license = files.find((f) => f.path === 'LICENSE');
  assert.ok(license);
  assert.match(license.content, /MIT License/);

  const docsPage = files.find((f) => f.path === 'docs/index.html');
  assert.ok(docsPage);
  assert.match(docsPage.content, /api\.github\.com\/repos\//);
  assert.match(docsPage.content, /octocat\/opentune/);
});

test('githubHelpers validates repo segments, branches, OAuth URLs, and statuses safely', () => {
  assert.equal(isValidGitHubSegment('octocat'), true);
  assert.equal(isValidGitHubSegment('ytm-native_v1.0'), true);
  assert.equal(isValidGitHubSegment('../evil'), false);
  assert.equal(isValidGitHubSegment('owner/repo'), false);

  assert.equal(isValidGitHubBranch('main'), true);
  assert.equal(isValidGitHubBranch('release/v1.0'), true);
  assert.equal(isValidGitHubBranch('main..evil'), false);

  assert.equal(validateNewRepoName('ytm-native-client'), null);
  assert.ok(validateNewRepoName('-bad-start'));
  assert.ok(validateNewRepoName('bad space'));

  const authUrl = buildGitHubAuthorizeUrl({
    clientId: 'Iv1.test',
    redirectUri: 'https://example.run.app/auth/github/callback',
    state: 'nonce123',
  });
  assert.match(authUrl, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  assert.match(authUrl, /scope=repo\+workflow/);
  assert.match(authUrl, /state=nonce123/);

  assert.equal(formatWorkflowStatusLabel('completed', 'success').tone, 'success');
  assert.equal(formatWorkflowStatusLabel('in_progress', null).tone, 'running');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('formatSeconds formats playback clock cleanly', () => {
  assert.equal(formatSeconds(0), '0:00');
  assert.equal(formatSeconds(65), '1:05');
  assert.equal(formatSeconds(258), '4:18');
});

test('workspaceCollector includes studio source under studio-web/ and blocks secrets', () => {
  assert.equal(isAllowedWorkspaceFileName('.env'), false);
  assert.equal(isAllowedWorkspaceFileName('.env.local'), false);
  assert.equal(isAllowedWorkspaceFileName('.env.example'), true);
  assert.equal(isAllowedWorkspaceFileName('App.tsx'), true);

  const files = collectStudioWorkspaceFiles(process.cwd(), 'studio-web');
  assert.ok(files.length > 10);
  assert.ok(files.some((f) => f.repoPath === 'studio-web/server.ts'));
  assert.ok(files.some((f) => f.repoPath === 'studio-web/src/App.tsx'));
  assert.ok(files.some((f) => f.repoPath === 'studio-web/.env.example'));
  assert.equal(
    files.some((f) => f.repoPath.includes('node_modules/') || f.repoPath.endsWith('/.env')),
    false
  );
});
