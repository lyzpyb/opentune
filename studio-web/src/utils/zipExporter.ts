import JSZip from 'jszip';
import type { ClientConfig, FileTargetGroup } from '../types/client';
import { generateClientProjectFiles } from './clientGenerator';

export type ExportScope = 'all' | FileTargetGroup;

export async function exportClientZip(
  config: ClientConfig,
  scope: ExportScope = 'all'
): Promise<{ fileName: string; fileCount: number }> {
  const allFiles = generateClientProjectFiles(config);
  const selectedFiles =
    scope === 'all' ? allFiles : allFiles.filter((file) => file.target === scope);

  const zip = new JSZip();
  for (const file of selectedFiles) {
    zip.file(file.path, file.content, {
      unixPermissions: file.executable ? '755' : '644',
    });
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const slug =
    config.appName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'ytm-native';

  const suffix =
    scope === 'all'
      ? 'full-project'
      : scope === 'macos'
        ? 'macos-dmg-src'
        : scope === 'android'
          ? 'android-apk-src'
          : 'github-actions';

  const fileName = `${slug}-${suffix}-v${config.version.trim() || '1.0.0'}.zip`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  return { fileName, fileCount: selectedFiles.length };
}
