// @vitest-environment node
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import * as React from 'react';
import { expect, test } from 'vitest';

// Exercise the provider's actual render branch without starting GPS or requiring
// a signed-in Convex account. React Native Web rejects even empty text in View.
const source = readFileSync(new URL('../src/components/runner-location-sharing.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('sharing.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let recoveryBranch: ts.JsxExpression | undefined;
function visit(node: ts.Node) {
  if (ts.isJsxExpression(node) && node.expression && node.expression.getText(file).includes("mode === 'availability'") &&
    node.expression.getText(file).includes('Restore location</CustomerButton>')) recoveryBranch = node;
  ts.forEachChild(node, visit);
}
visit(file);
if (!recoveryBranch?.expression) throw new Error('Availability recovery render branch not found');
const compiled = ts.transpileModule('return (' + recoveryBranch.expression.getText(file) + ');', {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;
const render = new Function('mode', 'error', 'canRun', 'restore', 'React', 'CustomerButton', compiled);

test.each(['availability', 'errand', null])('healthy %s mode never inserts a raw string into the provider View', mode => {
  const child = render(mode, '', true, () => {}, React, 'button');
  expect(typeof child).not.toBe('string');
  expect(React.Children.toArray(child)).toHaveLength(0);
});

test('availability error shows a working Restore location button instead of raw error text', () => {
  const restore = () => {};
  const child = render('availability', 'GPS unavailable', true, restore, React, 'button');
  expect(React.isValidElement(child)).toBe(true);
  expect(child.props).toMatchObject({ children: 'Restore location', onPress: restore, disabled: false });
  expect(render('errand', 'GPS unavailable', true, restore, React, 'button')).toBe(false);
});
