import { createDeskMasonry } from '../src/desk-masonry';
import { createDeskMasonry as createPrebatchMasonry } from './fixtures/desk-masonry-prebatch';

let manager, grid, cards;
const text = i => `${i} ${i % 2 ? 'Read the project notes and prepare the next implementation step. ' : '核对项目任务并整理需要继续处理的事项。'}`;
window.masonryHarness = {
  prepare({ count, width, baseline = false }) {
    manager?.destroy();
    document.body.replaceChildren();
    const root = document.createElement('section');
    root.className = 'nautilus-desk'; root.style.width = `${width}px`;
    grid = document.createElement('div');
    grid.className = 'rm-desk-overview rm-desk-overview--masonry nautilus-desk__grid';
    cards = Array.from({ length: count }, (_, i) => {
      const card = document.createElement('article'); card.className = 'rm-desk-tile nautilus-desk__card';
      const preview = document.createElement('div'); preview.className = 'rm-desk-tile__preview';
      const title = document.createElement('div'); title.className = 'rm-desk-tile__title'; title.textContent = text(i);
      preview.append(title);
      for (let row = 0; row < i % 5 + 1; row++) {
        const line = document.createElement('div'); line.className = 'rm-desk-tile__row';
        const body = document.createElement('span'); body.className = 'rm-desk-tile__text';
        body.textContent = text(i + row).repeat(row % 3 + 1); line.append(body); preview.append(line);
      }
      card.append(preview); grid.append(card); return card;
    });
    root.append(grid); document.body.append(root);
    manager = (baseline ? createPrebatchMasonry : createDeskMasonry)({ grid, host: window });
    grid.getBoundingClientRect();
  },
  layout() {
    const start = performance.now(); manager.setItems(cards); return performance.now() - start;
  },
  resize(width) {
    grid.parentElement.style.width = `${width}px`;
    window.dispatchEvent(new Event('resize'));
  },
  changeCard() {
    cards[0]?.querySelector('.rm-desk-tile__preview').append(document.createTextNode('Extra preview content '.repeat(15)));
  },
  removeCard() {
    cards.pop()?.remove(); manager.setItems(cards);
  },
  geometry() {
    const round = value => Math.round(value * 10000) / 10000;
    return {
      columns: grid.dataset.columns,
      gridHeight: round(grid.getBoundingClientRect().height),
      cards: cards.map(card => {
        const rect = card.getBoundingClientRect();
        return { span: card.style.gridRowEnd, x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
      }),
    };
  },
  destroy() { manager?.destroy(); document.body.replaceChildren(); },
};
