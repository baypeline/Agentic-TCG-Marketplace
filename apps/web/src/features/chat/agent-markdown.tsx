import { memo } from 'react';
import styled from '@emotion/styled';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const components: Components = {
  table: ({ children }) => <div className="agent-markdown-table"><table>{children}</table></div>,
};

export default memo(function AgentMarkdown({ content }: { content: string }) {
  return <MarkdownBody>
    <Markdown remarkPlugins={plugins} components={components} skipHtml>
      {content}
    </Markdown>
  </MarkdownBody>;
});

const MarkdownBody = styled.div(({ theme }) => ({
  '& > *': { margin: 0 },
  '& > * + *': { marginTop: 10 },
  '& h1, & h2, & h3, & h4, & h5, & h6': { fontSize: 15, fontWeight: 650, lineHeight: 1.5 },
  '& ul, & ol': { paddingInlineStart: '1.4em' },
  '& ul': { listStyle: 'disc' },
  '& ol': { listStyle: 'decimal' },
  '& li + li': { marginTop: 2 },
  '& li > p': { margin: 0 },
  '& a': { color: theme.color.link, textDecoration: 'underline', textUnderlineOffset: '0.14em' },
  '& img': { maxWidth: '100%', height: 'auto' },
  '& code': { fontSize: '0.9em', background: theme.color.demoBg, padding: '2px 4px', borderRadius: 4 },
  '& pre': { maxWidth: '100%', overflowX: 'auto', padding: 10, borderRadius: 6, background: theme.color.demoBg },
  '& pre code': { background: 'transparent', padding: 0, whiteSpace: 'pre', overflowWrap: 'normal' },
  '& blockquote': { paddingInlineStart: 10, borderInlineStart: `2px solid ${theme.color.line}`, color: theme.color.muted },
  '& blockquote > p': { margin: 0 },
  '& hr': { border: 0, borderTop: `1px solid ${theme.color.line}` },
  '& .agent-markdown-table': { maxWidth: '100%', overflowX: 'auto' },
  '& table': { borderCollapse: 'collapse', minWidth: '100%', fontSize: '0.9em' },
  '& th, & td': { border: `1px solid ${theme.color.line}`, textAlign: 'start', padding: '4px 6px', overflowWrap: 'normal' },
}));
