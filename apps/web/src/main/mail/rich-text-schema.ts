import { Extension, Node, type Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { Paragraph } from "@tiptap/extension-paragraph";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Image } from "@tiptap/extension-image";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";

export const SIGNATURE_ATTR = "data-signature";

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
]);

const FONT_SIZES: Record<string, string> = {
  "1": "x-small",
  "2": "small",
  "4": "large",
  "5": "x-large",
  "6": "xx-large",
  "7": "xxx-large",
};

const hasBlockChild = (el: Element) => [...el.children].some((c) => BLOCK_TAGS.has(c.tagName));

/** The plain-text part of a message: a line per line, list items marked. */
export function textOfHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const li of doc.querySelectorAll("li")) {
    const ordered = li.parentElement?.tagName === "OL";
    const index = [...(li.parentElement?.children ?? [])].indexOf(li) + 1;
    const depth = ancestorsOf(li, "UL, OL") - 1;
    li.prepend(`${"  ".repeat(depth)}${ordered ? `${index}.` : "-"} `);
  }
  for (const br of doc.querySelectorAll("br")) br.replaceWith(isLineEnd(br) ? "" : "\n");
  for (const el of doc.body.querySelectorAll("*")) {
    if ((BLOCK_TAGS.has(el.tagName) || el.tagName === "TR") && !hasBlockChild(el)) el.append("\n");
  }
  return (doc.body.textContent ?? "").replace(/\n+$/, "");
}

/** A <br> closing a line only gives an empty line its height; it isn't a line break. */
function isLineEnd(br: Element): boolean {
  const parent = br.parentElement;
  if (!parent || !BLOCK_TAGS.has(parent.tagName) || hasBlockChild(parent)) return false;
  let next = br.nextSibling;
  while (next && next.nodeType === 3 && !next.textContent?.trim()) next = next.nextSibling;
  return !next;
}

function ancestorsOf(el: Element, selector: string): number {
  let count = 0;
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.matches(selector)) count++;
  }
  return count;
}

function rawHtmlElement(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  const only = template.content.childNodes.length === 1 ? template.content.firstChild : null;
  if (only instanceof HTMLElement) return only;
  const div = document.createElement("div");
  div.append(template.content);
  return div;
}

function signatureElement(html: string): HTMLElement {
  const div = document.createElement("div");
  div.setAttribute(SIGNATURE_ATTR, "");
  div.innerHTML = html;
  return div;
}

/** The account's signature, kept as the HTML it came with and replaced whole when it changes. */
const Signature = Node.create({
  name: "signature",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ html: { default: "", rendered: false } }),
  parseHTML: () => [
    {
      tag: `div[${SIGNATURE_ATTR}]`,
      priority: 100,
      getAttrs: (el) => ({ html: el.innerHTML }),
    },
  ],
  renderHTML: ({ node }) => signatureElement(node.attrs.html as string),
  renderText: ({ node }) => textOfHtml(node.attrs.html as string),
});

/** Markup the editor has no model for (a table in a Gmail signature or draft), kept verbatim. */
const RawHtml = Node.create({
  name: "rawHtml",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ html: { default: "", rendered: false } }),
  parseHTML: () => [{ tag: "table", priority: 100, getAttrs: (el) => ({ html: el.outerHTML }) }],
  renderHTML: ({ node }) => rawHtmlElement(node.attrs.html as string),
  renderText: ({ node }) => textOfHtml(node.attrs.html as string),
});

/** Gmail writes a line as a <div>; a <p> would give each line a margin in the recipient's mail. */
const Line = Paragraph.extend({
  parseHTML: () => [
    { tag: "p" },
    {
      tag: "div",
      getAttrs: (el) => (hasBlockChild(el) ? false : null),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["div", HTMLAttributes, 0],
});

/** Mod-Enter sends the message, so only Shift-Enter breaks a line. */
const LineBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.setHardBreak() };
  },
});

const MailShortcuts = Extension.create({
  name: "mailShortcuts",
  priority: 50,
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
      "Mod-Shift-9": () => this.editor.commands.toggleBlockquote(),
      "Mod-\\": () => clearFormatting(this.editor),
      // A first item can't nest further; keep Tab from leaving the message.
      Tab: () => this.editor.isActive("listItem"),
    };
  },
});

export function clearFormatting(editor: Editor): boolean {
  return editor
    .chain()
    .focus()
    .unsetBold()
    .unsetItalic()
    .unsetUnderline()
    .unsetStrike()
    .unsetMark("textStyle")
    .run();
}

export function mailExtensions() {
  return [
    StarterKit.configure({
      paragraph: false,
      hardBreak: false,
      heading: false,
      code: false,
      codeBlock: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    Line,
    LineBreak,
    Signature,
    RawHtml,
    Image.configure({ inline: true, allowBase64: true }),
    TextStyle,
    Color,
    FontSize,
    MailShortcuts,
  ];
}

/**
 * Reads mail HTML into the editor's terms: <font> (old messages, Gmail signatures) as a styled
 * span, and without the <br> a browser leaves at the end of a line to give it height.
 */
export function normalizeHtml(html: string): string {
  if (!/<font\b|<br\b/i.test(html)) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const font of template.content.querySelectorAll("font")) {
    const span = document.createElement("span");
    const color = font.getAttribute("color");
    const size = FONT_SIZES[font.getAttribute("size") ?? ""];
    const face = font.getAttribute("face");
    if (color) span.style.color = color;
    if (size) span.style.fontSize = size;
    if (face) span.style.fontFamily = face;
    span.append(...font.childNodes);
    font.replaceWith(span);
  }
  for (const br of template.content.querySelectorAll("br")) {
    if (!br.closest(`[${SIGNATURE_ATTR}], table`) && isLineEnd(br)) br.remove();
  }
  return template.innerHTML;
}

/** Pasted text keeps its structure and emphasis, not the page's colors, fonts and sizes. */
export function withoutPastedStyles(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = normalizeHtml(html);
  for (const el of template.content.querySelectorAll<HTMLElement>("[style]")) {
    for (const prop of ["color", "background", "background-color", "font-size", "font-family"]) {
      el.style.removeProperty(prop);
    }
    if (el.style.length === 0) el.removeAttribute("style");
  }
  return template.innerHTML;
}

/** Nothing typed yet: only empty lines, around the signature. */
export function isBlank(state: EditorState): boolean {
  let blank = true;
  state.doc.forEach((node) => {
    if (node.type.name === "signature") return;
    if (node.type.name !== "paragraph" || node.childCount > 0) blank = false;
  });
  return blank;
}

/** An empty line renders no height in mail clients; a <br> gives it one. */
export function emailHtml(html: string): string {
  return html.replace(/<div><\/div>/g, "<div><br></div>");
}
