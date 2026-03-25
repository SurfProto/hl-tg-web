/**
 * Telegram Mini App haptic feedback utility.
 * Safely no-ops when not running inside Telegram.
 */

function getHaptic() {
  return window.Telegram?.WebApp?.HapticFeedback;
}

export function useHaptics() {
  return {
    /** Light tap - tab switches, toggles */
    light: () => getHaptic()?.impactOccurred('light'),
    /** Medium tap - button presses, selections */
    medium: () => getHaptic()?.impactOccurred('medium'),
    /** Heavy tap - important actions */
    heavy: () => getHaptic()?.impactOccurred('heavy'),
    /** Success notification - order placed, approval done */
    success: () => getHaptic()?.notificationOccurred('success'),
    /** Error notification - failed action */
    error: () => getHaptic()?.notificationOccurred('error'),
    /** Warning notification - approval needed */
    warning: () => getHaptic()?.notificationOccurred('warning'),
    /** Selection changed - picker, slider */
    selection: () => getHaptic()?.selectionChanged(),
  };
}
