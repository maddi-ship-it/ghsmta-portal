const THEME_SCRIPT = `
  try {
    var savedTheme = window.localStorage.getItem("ghsmta-theme");
    var theme = savedTheme === "light" ? "light" : "dark";
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
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
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
