'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { applicationFieldExtractor, isStandardField } = require('../scripts/apply-extract');

class FakeElement {
  constructor(tagName, attrs = {}, children = [], text = '') {
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs;
    this.children = children;
    this.parentElement = null;
    this.innerText = text;
    this.textContent = text;
    this.type = attrs.type || '';
    this.name = attrs.name || '';
    this.id = attrs.id || '';
    this.required = Boolean(attrs.required);
    this.className = attrs.class || '';
    this.options = this.tagName === 'SELECT' ? children : [];
    this.value = attrs.value || '';
    for (const child of children) child.parentElement = this;
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  getBoundingClientRect() {
    return { width: 100, height: 20 };
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  matches(selector) {
    return selector.split(',').map((part) => part.trim()).some((part) => {
      if (part === this.tagName.toLowerCase()) return true;
      if (part === 'fieldset' && this.tagName === 'FIELDSET') return true;
      if (part === 'label' && this.tagName === 'LABEL') return true;
      if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1));
      if (part.startsWith('[class*="')) {
        const value = part.match(/\[class\*="([^"]+)"\]/)?.[1] || '';
        return this.className.includes(value);
      }
      return false;
    });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    const results = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (selectors.some((part) => child.matchesSimple(part))) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  matchesSimple(selector) {
    if (['input', 'textarea', 'select', 'option', 'label', 'legend', 'h1', 'h2', 'h3', 'h4'].includes(selector)) {
      return this.tagName.toLowerCase() === selector;
    }
    if (selector === 'input[type="radio"]') return this.tagName === 'INPUT' && this.type === 'radio';
    if (selector === 'input[type="checkbox"]') return this.tagName === 'INPUT' && this.type === 'checkbox';
    if (selector.startsWith('[class*="')) return this.matches(selector);
    return this.matches(selector);
  }

  cloneNode(deep) {
    const children = deep ? this.children.map((child) => child.cloneNode(true)) : [];
    return new FakeElement(this.tagName, { ...this.attrs }, children, this.innerText);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

function input(attrs) {
  return new FakeElement('input', attrs);
}

function option(text) {
  return new FakeElement('option', {}, [], text);
}

function textNodeElement(tag, text, children = [], attrs = {}) {
  return new FakeElement(tag, attrs, children, text);
}

function buildDocument(root) {
  const all = [];
  const visit = (node) => {
    all.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);

  return {
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') {
        return all.filter((node) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
      }
      if (selector === 'input[type="hidden"][name^="cards["][name$="[baseTemplate]"]') {
        return all.filter((node) => (
          node.tagName === 'INPUT'
          && node.type === 'hidden'
          && node.name.startsWith('cards[')
          && node.name.endsWith('[baseTemplate]')
        ));
      }
      const radio = selector.match(/^input\[type="radio"\]\[name="([^"]+)"\]$/);
      if (radio) return all.filter((node) => node.tagName === 'INPUT' && node.type === 'radio' && node.name === radio[1]);
      const checkbox = selector.match(/^input\[type="checkbox"\]\[name="([^"]+)"\]$/);
      if (checkbox) return all.filter((node) => node.tagName === 'INPUT' && node.type === 'checkbox' && node.name === checkbox[1]);
      const labelFor = selector.match(/^label\[for="([^"]+)"\]$/);
      if (labelFor) return all.filter((node) => node.tagName === 'LABEL' && node.attrs.for === labelFor[1]);
      return root.querySelectorAll(selector);
    },
  };
}

describe('apply-extract DOM extraction', () => {
  it('does not drop source questions that mention LinkedIn as an answer example', () => {
    assert.equal(
      isStandardField(
        'cards[card-one][field4]',
        'How did you hear about us? (LinkedIn, referral, etc.)'
      ),
      false
    );
  });

  it('extracts grouped Lever fields and custom essay cards', () => {
    const baseTemplate = input({
      name: 'cards[card-one][baseTemplate]',
      type: 'hidden',
      value: JSON.stringify({
        fields: [
          {
            type: 'multiple-select',
            text: 'Are you legally authorized to work in the country in which you are applying?',
            required: true,
            options: [{ text: 'Yes' }, { text: 'No' }],
          },
          {
            type: 'textarea',
            text: 'Describe a specific bottleneck you identified in a CI/CD pipeline.',
            required: true,
          },
        ],
      }),
    });
    const currentCompany = textNodeElement('label', 'Current company ✱', [
      input({ name: 'org', type: 'text', required: true }),
    ], { class: 'application-field' });
    const auth = textNodeElement('fieldset', 'Are you legally authorized to work in the country in which you are applying?✱ Yes No', [
      textNodeElement('legend', 'Are you legally authorized to work in the country in which you are applying?✱'),
      textNodeElement('label', 'Yes', [input({ name: 'cards[card-one][field0]', type: 'checkbox' })]),
      textNodeElement('label', 'No', [input({ name: 'cards[card-one][field0]', type: 'checkbox' })]),
    ], { class: 'application-question' });
    const essay = textNodeElement('div', 'Describe a specific bottleneck you identified in a CI/CD pipeline.✱', [
      textNodeElement('h3', 'Describe a specific bottleneck you identified in a CI/CD pipeline.✱'),
      new FakeElement('textarea', { name: 'cards[card-one][field1]', required: true }),
    ], { class: 'application-question-card' });
    const gender = textNodeElement('label', 'Gender', [
      new FakeElement('select', { name: 'eeo[gender]' }, [
        option('Select ...'),
        option('Male'),
        option('Female'),
        option('Decline to self-identify'),
      ]),
    ], { class: 'application-field' });
    const root = new FakeElement('form', {}, [baseTemplate, currentCompany, auth, essay, gender]);

    const previousDocument = global.document;
    const previousWindow = global.window;
    const previousCss = global.CSS;

    try {
      global.document = buildDocument(root);
      global.window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
      global.CSS = { escape: (value) => String(value) };

      const fields = applicationFieldExtractor();

      assert.deepEqual(fields.map((field) => field.name), [
        'org',
        'cards[card-one][field0]',
        'cards[card-one][field1]',
        'eeo[gender]',
      ]);
      assert.equal(fields[1].labelText, 'Are you legally authorized to work in the country in which you are applying?');
      assert.equal(fields[1].type, 'multi_select');
      assert.deepEqual(fields[1].options, ['Yes', 'No']);
      assert.equal(fields[2].labelText, 'Describe a specific bottleneck you identified in a CI/CD pipeline.');
      assert.equal(fields[2].type, 'textarea');
      assert.equal(fields[2].required, true);
      assert.equal(fields[3].labelText, 'Gender');
      assert.deepEqual(fields[3].options, ['Select ...', 'Male', 'Female', 'Decline to self-identify']);
    } finally {
      global.document = previousDocument;
      global.window = previousWindow;
      global.CSS = previousCss;
    }
  });
});
