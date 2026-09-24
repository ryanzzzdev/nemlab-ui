// Apply the saved preference before the page paints. Storage may be unavailable.
try {
  const theme = localStorage.getItem("nemlab-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // The CSS default follows the device appearance.
}
