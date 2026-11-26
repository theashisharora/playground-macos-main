/**
 * Remark plugin: turns `==keyword==` in markdown text into
 * `<span class="accent">keyword</span>` (red highlight, see `.accent` in
 * `src/styles/component.css`).
 *
 * Only plain text nodes are rewritten, so raw HTML stays disabled in the
 * markdown renderer. Code spans/blocks are untouched because their content
 * lives in `inlineCode` / `code` nodes, not `text` nodes.
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

const ACCENT_RE = /==([^=\n]+?)==/g;

const splitText = (value: string): MdNode[] => {
  const nodes: MdNode[] = [];
  let last = 0;

  for (const match of value.matchAll(ACCENT_RE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push({ type: "text", value: value.slice(last, start) });
    nodes.push({
      type: "accent",
      children: [{ type: "text", value: match[1] }],
      data: { hName: "span", hProperties: { className: ["accent"] } }
    });
    last = start + match[0].length;
  }

  if (last < value.length) nodes.push({ type: "text", value: value.slice(last) });
  return nodes;
};

const transform = (node: MdNode) => {
  if (!node.children) return;

  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value?.includes("==")) {
      return splitText(child.value);
    }
    transform(child);
    return [child];
  });
};

export default function remarkAccent() {
  return (tree: MdNode) => transform(tree);
}
