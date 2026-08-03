const THEME_SCRIPT = `
  try {
    var savedTheme = window.localStorage.getItem("ghsmta-theme-preference");
    var legacyTheme = window.localStorage.getItem("ghsmta-theme");
    var preference = ["system", "light", "dark"].includes(savedTheme)
      ? savedTheme
      : (legacyTheme === "light" || legacyTheme === "dark" ? legacyTheme : "system");
    var theme = preference === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : preference;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute(
        "content",
        theme === "light" ? "#edf1f7" : "#070b18"
      );
    }
  } catch (error) {
    document.documentElement.dataset.themePreference = "system";
    var fallbackTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    document.documentElement.dataset.theme = fallbackTheme;
    document.documentElement.style.colorScheme = fallbackTheme;
  }
`;

export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
      id="ghsmta-theme-script"
    />
  );
}
