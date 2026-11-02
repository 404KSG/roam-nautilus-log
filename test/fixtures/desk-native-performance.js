export * from '../../src/desk-native';
import { nativePreviewText as original } from '../../src/desk-native';

// Test-only adapter: instrument the actual fallback parser without changing
// its result or exposing a production hook on createDeskView.
export const nativePreviewText = (...args) => {
  window.deskPreviewPerformance ||= { fallbackParses: 0 };
  window.deskPreviewPerformance.fallbackParses += 1;
  return original(...args);
};
