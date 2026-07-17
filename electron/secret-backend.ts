export const secureSecretStorageAvailable = (
  platform: NodeJS.Platform,
  encryptionAvailable: boolean,
  linuxBackend?: string,
) => encryptionAvailable && (platform !== 'linux' || (linuxBackend !== 'basic_text' && linuxBackend !== 'unknown'))
