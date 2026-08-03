/* 轻量 Markdown 渲染器（零依赖，先转义再渲染，安全） */

const MD = (() => {
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function inline(text) {
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  function render(markdown) {
    if (!markdown) return "";
    const lines = markdown.split(/\r?\n/);
    const html = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === "") { i++; continue; }

      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          buf.push(lines[i]); i++;
        }
        i++;
        html.push("<pre><code>" + escapeHtml(buf.join("\n")) + "</code></pre>");
        continue;
      }

      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) {
        const level = h[1].length;
        html.push("<h" + level + ">" + inline(h[2]) + "</h" + level + ">");
        i++;
        continue;
      }

      if (/^---+\s*$/.test(line.trim())) {
        html.push("<hr>");
        i++;
        continue;
      }

      if (line.trim().startsWith(">")) {
        const buf = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          buf.push(lines[i].trim().replace(/^>\s?/, ""));
          i++;
        }
        html.push("<blockquote>" + inline(buf.join(" ")) + "</blockquote>");
        continue;
      }

      const ul = line.match(/^\s*[-*+]\s+(.*)/);
      if (ul) {
        const buf = [];
        while (i < lines.length) {
          const m = lines[i].match(/^\s*[-*+]\s+(.*)/);
          if (!m) break;
          buf.push("<li>" + inline(m[1]) + "</li>");
          i++;
        }
        html.push("<ul>" + buf.join("") + "</ul>");
        continue;
      }

      const ol = line.match(/^\s*\d+[.、)]\s+(.*)/);
      if (ol) {
        const buf = [];
        while (i < lines.length) {
          const m = lines[i].match(/^\s*\d+[.、)]\s+(.*)/);
          if (!m) break;
          buf.push("<li>" + inline(m[1]) + "</li>");
          i++;
        }
        html.push("<ol>" + buf.join("") + "</ol>");
        continue;
      }

      const tbl = line.includes("|") && /^\s*\|/.test(line);
      if (tbl && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const rows = [];
        while (i < lines.length && lines[i].includes("|")) {
          rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
          i++;
        }
        if (rows.length >= 2) {
          let t = "<table><thead><tr>";
          rows[0].forEach((c) => { t += "<th>" + inline(c) + "</th>"; });
          t += "</tr></thead><tbody>";
          for (let r = 2; r < rows.length; r++) {
            t += "<tr>";
            rows[r].forEach((c) => { t += "<td>" + inline(c) + "</td>"; });
            t += "</tr>";
          }
          t += "</tbody></table>";
          html.push(t);
        }
        continue;
      }

      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].trim().startsWith("```") &&
        !/^(#{1,4})\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+[.、)]\s+/.test(lines[i]) &&
        !lines[i].trim().startsWith(">")
      ) {
        para.push(lines[i]); i++;
      }
      html.push("<p>" + inline(para.join("<br>")) + "</p>");
    }

    return html.join("\n");
  }

  /* 渲染 LaTeX 公式（KaTeX auto-render；未加载时原样显示，不报错） */
  function afterRender(root) {
    if (!root || !window.renderMathInElement) return;
    try {
      renderMathInElement(root, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false,
        strict: false
      });
    } catch (e) {}
  }

  return { render, afterRender };
})();

/* KaTeX 资源加载完成后，对页面上已有内容补渲染 */
window.addEventListener("load", () => {
  document.querySelectorAll(".md").forEach((el) => MD.afterRender(el));
});
