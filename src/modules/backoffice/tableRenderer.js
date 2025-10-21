const path = require('path');

function createTableRenderer({ fs, esc, renderModalShell, html, renderIcon }) {
  if (!fs || typeof fs.readFileSync !== 'function') {
    throw new Error('createTableRenderer requires a file system instance.');
  }
  if (!renderModalShell || typeof renderModalShell !== 'function') {
    throw new Error('createTableRenderer requires a renderModalShell function.');
  }
  if (!renderIcon || typeof renderIcon !== 'function') {
    throw new Error('createTableRenderer requires a renderIcon function.');
  }

  const templatePath = path.join(__dirname, '..', '..', 'views', 'partials', 'table.ejs');
  let templateCache = null;

  function loadTemplate() {
    if (templateCache) return templateCache;
    try {
      templateCache = fs.readFileSync(templatePath, 'utf8');
    } catch (err) {
      console.error('Falha ao carregar partial da tabela:', err.message);
      templateCache = '__TABLE_FALLBACK__';
    }
    return templateCache;
  }

  function getTranslator(translator) {
    return typeof translator === 'function' ? translator : key => key;
  }

  function encode(value) {
    return encodeURIComponent(value != null ? String(value) : '');
  }

  function normalizeQuery(query) {
    if (!query || typeof query !== 'object') return {};
    const output = {};
    Object.keys(query).forEach(key => {
      if (query[key] == null) return;
      output[key] = String(query[key]);
    });
    return output;
  }

  function buildQueryString(params) {
    const entries = Object.entries(params).filter(([, value]) => value != null && value !== '');
    if (!entries.length) return '';
    return entries
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
  }

  function buildUrl(action, params) {
    const base = action || '';
    const query = buildQueryString(params);
    if (!query) return base || '#';
    return `${base || ''}?${query}`;
  }

  function renderControls({ action, search, filters, preserveKeys, query, t }) {
    const translate = getTranslator(t);
    const pieces = [];
    const hiddenInputs = [];
    const safePreserve = Array.isArray(preserveKeys) ? preserveKeys : [];
    safePreserve.forEach(key => {
      if (!key) return;
      const value = query[key];
      if (value == null || value === '') return;
      hiddenInputs.push(`<input type="hidden" name="${esc(key)}" value="${esc(value)}" />`);
    });

    const searchLabelText = search && search.label
      ? search.label
      : translate('table.controls.searchLabel', { defaultValue: 'Search' });
    const searchPlaceholderText = search && search.placeholder
      ? search.placeholder
      : translate('table.controls.searchPlaceholder', { defaultValue: 'Search…' });

    const searchBlock = search && search.name
      ? `<label class="bo-data-table__search">`
          + `<span class="bo-data-table__label">${esc(searchLabelText)}</span>`
          + `<input type="search" class="input" name="${esc(search.name)}" value="${esc(search.value || '')}"`
          + ` placeholder="${esc(searchPlaceholderText)}" />`
        + `</label>`
      : '';

    const filterBlocks = Array.isArray(filters)
      ? filters
          .map(filter => {
            if (!filter || !filter.name) return '';
            const filterLabelText = filter.label
              ? filter.label
              : translate('table.controls.filterLabel', { defaultValue: 'Filter' });
            const options = Array.isArray(filter.options)
              ? filter.options
                  .map(option => {
                    const selected = String(option.value || '') === String(filter.value || '') ? ' selected' : '';
                    return `<option value="${esc(option.value || '')}"${selected}>${esc(option.label || option.value || '')}</option>`;
                  })
                  .join('')
              : '';
            return `
              <label class="bo-data-table__filter">
                <span class="bo-data-table__label">${esc(filterLabelText)}</span>
                <select name="${esc(filter.name)}" class="input">
                  ${options}
                </select>
              </label>
            `;
          })
          .filter(Boolean)
          .join('')
      : '';

    if (!searchBlock && !filterBlocks) return '';

    pieces.push('<form class="bo-data-table__controls" method="get" action="' + esc(action || '') + '">');
    if (hiddenInputs.length) {
      pieces.push(hiddenInputs.join(''));
    }
    if (searchBlock) pieces.push(searchBlock);
    if (filterBlocks) pieces.push(`<div class="bo-data-table__filters">${filterBlocks}</div>`);
    const applyLabel = translate('table.controls.submit', { defaultValue: 'Apply' });
    pieces.push(
      `<button type="submit" class="btn btn-primary bo-data-table__submit">${esc(applyLabel)}</button>`
    );
    pieces.push('</form>');
    return pieces.join('');
  }

  function renderSortIcon(isActive, direction, t) {
    const translate = getTranslator(t);
    if (!isActive) {
      return renderIcon('arrow-up-down', {
        className: 'w-4 h-4',
        label: translate('table.sort.unsorted', { defaultValue: 'Sort' })
      });
    }
    const labelKey = direction === 'desc' ? 'table.sort.desc' : 'table.sort.asc';
    return renderIcon(direction === 'desc' ? 'arrow-down' : 'arrow-up', {
      className: 'w-4 h-4',
      label: translate(labelKey, {
        defaultValue: direction === 'desc' ? 'Sort descending' : 'Sort ascending'
      })
    });
  }

  function renderHeaders({ columns, sort, action, query, preserve, t }) {
    return columns
      .map(column => {
        const classes = ['bo-data-table__header'];
        if (column.align === 'right') classes.push('is-right');
        if (column.align === 'center') classes.push('is-center');
        if (column.isAction) classes.push('is-actions');
        const label = esc(column.label || '');
        if (!column.sortable || !column.key) {
          return `<th class="${classes.join(' ')}" scope="col">${label}</th>`;
        }
        const isActive = sort.key === column.key;
        const currentDirection = isActive ? sort.direction : 'asc';
        const nextDirection = isActive && currentDirection === 'asc' ? 'desc' : 'asc';
        const params = { ...query, sort: column.key, direction: nextDirection, page: 1 };
        preserve.forEach(key => {
          if (key === 'page') params[key] = 1;
        });
        const url = buildUrl(action, params);
        const icon = renderSortIcon(isActive, currentDirection, t);
        const sortClasses = ['bo-data-table__sort'];
        if (isActive) sortClasses.push('is-active', `is-${currentDirection}`);
        return `
          <th class="${classes.join(' ')}" scope="col">
            <a class="${sortClasses.join(' ')}" href="${url}">
              <span>${label}</span>
              ${icon}
            </a>
          </th>
        `;
      })
      .join('');
  }

  function renderCellContent(cell) {
    if (cell == null) {
      return '<span class="bo-data-table__muted">—</span>';
    }
    if (typeof cell === 'string' || typeof cell === 'number') {
      return `<span class="bo-data-table__value">${esc(String(cell))}</span>`;
    }
    if (cell.html) {
      return cell.html;
    }
    const parts = [];
    const primary = cell.text || cell.value || cell.primary;
    if (primary) {
      parts.push(`<span class="bo-data-table__value">${esc(primary)}</span>`);
    }
    if (cell.secondary) {
      parts.push(`<span class="bo-data-table__muted">${esc(cell.secondary)}</span>`);
    }
    if (cell.badge) {
      parts.push(
        `<span class="bo-data-table__badge ${cell.badgeTone ? 'is-' + esc(cell.badgeTone) : ''}">${esc(cell.badge)}</span>`
      );
    }
    if (!parts.length) {
      return '<span class="bo-data-table__muted">—</span>';
    }
    return parts.join('');
  }

  function renderActions({ tableId, row, rowIndex, actions, modals, query, actionForms, t }) {
    const translate = getTranslator(t);
    if (!Array.isArray(actions) || !actions.length) return '';
    const items = [];

    const defaultConfirmLabel = translate('table.confirm.accept', { defaultValue: 'Confirm' });
    const defaultCancelLabel = translate('table.confirm.cancel', { defaultValue: 'Cancel' });
    const defaultConfirmTitle = translate('table.confirm.title', { defaultValue: 'Confirm action' });

    actions.forEach((action, actionIndex) => {
      if (!action || !action.label) return;
      const actionId = `${tableId}-action-${rowIndex}-${actionIndex}`;
      const iconMarkup = action.icon ? renderIcon(action.icon, { className: 'w-4 h-4' }) : '';
      const label = `<span>${esc(action.label)}</span>`;
      const baseClasses = ['bo-data-table__action'];
      if (action.variant) {
        baseClasses.push(`is-${esc(action.variant)}`);
      }
      const classAttr = baseClasses.join(' ');
      const dataset = [];
      if (row && row.id != null) {
        dataset.push(`data-row-id="${esc(row.id)}"`);
      }
      dataset.push(`data-action-id="${esc(actionId)}"`);
      if (action.data && typeof action.data === 'object') {
        Object.entries(action.data).forEach(([key, value]) => {
          if (!key) return;
          dataset.push(`data-${key.replace(/[^a-z0-9_-]/gi, '').toLowerCase()}="${esc(value)}"`);
        });
      }

      if (action.type === 'link') {
        const href = action.href ? buildUrl(action.href, action.params || {}) : '#';
        items.push(
          `<a class="${classAttr}" href="${href}" ${dataset.join(' ')} data-table-action data-action="${esc(
            action.name || action.key || 'link'
          )}">${iconMarkup}${label}</a>`
        );
        return;
      }

      if (action.type === 'post') {
        const formId = `${tableId}-form-${rowIndex}-${actionIndex}`;
        const method = action.method ? action.method.toUpperCase() : 'POST';
        const hidden = Array.isArray(action.hidden)
          ? action.hidden
              .map(field => {
                if (!field || !field.name) return '';
                return `<input type="hidden" name="${esc(field.name)}" value="${esc(field.value || '')}" />`;
              })
              .join('')
          : '';
        const needsConfirm = !!action.confirm;
        const buttonAttrs = [
          `class="${classAttr}"`,
          `data-table-action`,
          `data-action="${esc(action.name || action.key || 'post')}"`,
          ...dataset
        ];
        if (needsConfirm) {
          const modalId = `${tableId}-confirm-${rowIndex}-${actionIndex}`;
          buttonAttrs.push(`type="button"`, `data-confirm-trigger="${modalId}"`);
          const confirm = action.confirm || {};
          const confirmLabel = esc(confirm.confirmLabel || defaultConfirmLabel);
          const cancelLabel = esc(defaultCancelLabel);
          const modalTitle = confirm.title || defaultConfirmTitle;
          const bodyParts = [];
          if (confirm.message) {
            bodyParts.push(`<p class="mb-4 text-sm text-slate-600">${esc(confirm.message)}</p>`);
          }
          bodyParts.push(
            `<div class="flex justify-end gap-2">
              <button type="button" class="btn btn-muted" data-modal-close>${cancelLabel}</button>
              <button type="submit" form="${formId}" class="btn btn-danger" data-confirm-accept="${actionId}" data-confirm-modal="${modalId}">${confirmLabel}</button>
            </div>`
          );
          modals.push(
            renderModalShell({
              id: modalId,
              title: modalTitle,
              body: `<div class="space-y-4">${bodyParts.join('')}</div>`,
              extraRootAttr: `data-confirm-modal data-related-action="${actionId}`
            })
          );
        } else {
          buttonAttrs.push('type="submit"');
        }
        const formHtml = `
          <form id="${formId}" method="${method}" action="${esc(action.action || '#')}" class="bo-data-table__form">
            ${hidden}
            <button ${buttonAttrs.join(' ')}>${iconMarkup}${label}</button>
          </form>
        `;
        actionForms.push(formHtml);
        items.push(formHtml);
        return;
      }

      const actionName = esc(action.name || action.key || 'action');
      if (action.type === 'button') {
        const needsConfirm = !!action.confirm;
        if (needsConfirm) {
          const modalId = `${tableId}-confirm-${rowIndex}-${actionIndex}`;
          dataset.push(`data-confirm-trigger="${modalId}"`);
          const confirm = action.confirm || {};
          const confirmLabel = esc(confirm.confirmLabel || defaultConfirmLabel);
          const cancelLabel = esc(defaultCancelLabel);
          const modalTitle = confirm.title || defaultConfirmTitle;
          const bodyParts = [];
          if (confirm.message) {
            bodyParts.push(`<p class="mb-4 text-sm text-slate-600">${esc(confirm.message)}</p>`);
          }
          bodyParts.push(
            `<div class="flex justify-end gap-2">
              <button type="button" class="btn btn-muted" data-modal-close>${cancelLabel}</button>
              <button type="button" class="btn btn-danger" data-confirm-accept="${actionId}" data-confirm-modal="${modalId}" data-confirm-fire="${actionId}">${confirmLabel}</button>
            </div>`
          );
          modals.push(
            renderModalShell({
              id: modalId,
              title: modalTitle,
              body: `<div class="space-y-4">${bodyParts.join('')}</div>`,
              extraRootAttr: `data-confirm-modal data-related-action="${actionId}`
            })
          );
        }
        items.push(
          `<button type="button" class="${classAttr}" data-table-action data-action="${actionName}" ${dataset.join(
            ' '
          )}>${iconMarkup}${label}</button>`
        );
      }
    });

    if (!items.length) return '';
    const formsHtml = actionForms.join('');
    const buttons = items.filter(item => !item.startsWith('<form')).join('');
    return `${formsHtml}<div class="bo-data-table__actions">${buttons}</div>`;
  }

  function renderRows({ columns, rows, tableId, query, t }) {
    const modals = [];
    const actionForms = [];
    const renderedRows = rows
      .map((row, rowIndex) => {
        const rowClasses = ['bo-data-table__row'];
        if (row.highlight) rowClasses.push('is-highlighted');
        const cells = [];
        let dataIndex = 0;
        columns.forEach((column, columnIndex) => {
          const cellClasses = ['bo-data-table__cell'];
          if (column.align === 'right') cellClasses.push('is-right');
          if (column.align === 'center') cellClasses.push('is-center');
          const dataLabel = esc(column.label || '');
          if (column.isAction) {
            const actionsHtml = renderActions({
              tableId,
              row,
              rowIndex,
              actions: row.actions,
              modals,
              query,
              actionForms,
              t
            });
            cells.push(
              `<td class="${cellClasses.join(' ')}" data-label="${dataLabel}">${actionsHtml || '<span class="bo-data-table__muted">—</span>'}</td>`
            );
            return;
          }
          const cellData = Array.isArray(row.cells) ? row.cells[dataIndex] : null;
          cells.push(
            `<td class="${cellClasses.join(' ')}" data-label="${dataLabel}">${renderCellContent(cellData)}</td>`
          );
          dataIndex += 1;
        });
        return `<tr class="${rowClasses.join(' ')}" data-row-id="${row.id != null ? esc(row.id) : ''}">${cells.join('')}</tr>`;
      })
      .join('');
    return { rowsHtml: renderedRows, modalsHtml: modals.join(''), formsHtml: actionForms.join('') };
  }

  function renderEmptyState(colspan, emptyState, t) {
    const translate = getTranslator(t);
    const message = emptyState || translate('table.empty', {
      defaultValue: 'No results found. Adjust filters or add a new record.'
    });
    return `<tr class="bo-data-table__row-empty"><td class="bo-data-table__empty" colspan="${colspan}">${esc(message)}</td></tr>`;
  }

  function renderPagination({ action, query, pagination, t }) {
    const translate = getTranslator(t);
    if (!pagination || pagination.pageCount <= 1) return '';
    const page = pagination.page;
    const total = pagination.total || 0;
    const pageSize = pagination.pageSize || 15;
    const pageCount = pagination.pageCount;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    const baseQuery = { ...query };
    const prevDisabled = page <= 1;
    const nextDisabled = page >= pageCount;
    const prevUrl = buildUrl(action, { ...baseQuery, page: Math.max(1, page - 1) });
    const nextUrl = buildUrl(action, { ...baseQuery, page: Math.min(pageCount, page + 1) });
    const rangeLabel = translate('table.pagination.range', {
      defaultValue: '{from}–{to} of {total}',
      values: { from: start, to: end, total }
    });
    const pageCounter = translate('table.pagination.pageCounter', {
      defaultValue: 'Page {page} of {pageCount}',
      values: { page, pageCount }
    });
    const prevLabel = translate('table.pagination.previous', { defaultValue: 'Previous' });
    const nextLabel = translate('table.pagination.next', { defaultValue: 'Next' });
    const ariaLabel = translate('table.pagination.aria', { defaultValue: 'Pagination' });
    return `
      <nav class="bo-data-table__pagination" aria-label="${esc(ariaLabel)}">
        <p class="bo-data-table__pagination-label">${esc(rangeLabel)}</p>
        <div class="bo-data-table__pagination-actions">
          ${prevDisabled
            ? `<span class="bo-data-table__page-link is-disabled">${esc(prevLabel)}</span>`
            : `<a class="bo-data-table__page-link" href="${prevUrl}">${esc(prevLabel)}</a>`}
          <span class="bo-data-table__page-counter">${esc(pageCounter)}</span>
          ${nextDisabled
            ? `<span class="bo-data-table__page-link is-disabled">${esc(nextLabel)}</span>`
            : `<a class="bo-data-table__page-link" href="${nextUrl}">${esc(nextLabel)}</a>`}
        </div>
      </nav>
    `;
  }

  function renderTable(options) {
    const template = loadTemplate();
    const translate = getTranslator(options && options.t);
    if (template === '__TABLE_FALLBACK__') {
      const message = translate('table.errorLoading', {
        defaultValue: 'We could not load the table.'
      });
      return `
        <section class="bo-data-table">
          <div class="alert alert-danger">${esc(message)}</div>
        </section>
      `;
    }
    const tableId = options.id || `data-table-${Date.now()}`;
    const action = options.action || '';
    const query = normalizeQuery(options.query);
    const baseColumns = Array.isArray(options.columns) ? options.columns.slice() : [];
    const hasActionsColumn = baseColumns.some(col => col && (col.isAction || col.key === 'actions'));
    const actionsLabel = options.actionsLabel
      ? options.actionsLabel
      : translate('table.actionsColumn', { defaultValue: 'Actions' });
    const columns = hasActionsColumn
      ? baseColumns.map(col => (col.key === 'actions' ? { ...col, isAction: true } : col))
      : baseColumns.concat([{ key: 'actions', label: actionsLabel, isAction: true, align: 'right' }]);

    const sort = {
      key: options.sort && options.sort.key ? String(options.sort.key) : '',
      direction: options.sort && options.sort.direction === 'desc' ? 'desc' : 'asc'
    };

    const pagination = options.pagination
      ? {
          page: Math.max(1, Number.parseInt(options.pagination.page, 10) || 1),
          pageSize: Math.max(1, Number.parseInt(options.pagination.pageSize, 10) || 15),
          pageCount: Math.max(1, Number.parseInt(options.pagination.pageCount, 10) || 1),
          total: Math.max(0, Number.parseInt(options.pagination.total, 10) || 0)
        }
      : null;

    const controlsHtml = renderControls({
      action,
      search: options.search,
      filters: options.filters,
      preserveKeys: options.preserve || ['sort', 'direction'],
      query,
      t: translate
    });

    const headersHtml = renderHeaders({ columns, sort, action, query, preserve: options.preserve || [], t: translate });

    const rowsInput = Array.isArray(options.rows) ? options.rows : [];
    const { rowsHtml, modalsHtml } = renderRows({ columns, rows: rowsInput, tableId, query, t: translate });

    const bodyHtml = rowsInput.length
      ? rowsHtml
      : renderEmptyState(columns.length, options.emptyState, translate);

    const paginationHtml = renderPagination({ action, query, pagination, t: translate });

    const replacements = [
      ['__TABLE_ID__', esc(tableId)],
      ['<!--TABLE_CONTROLS-->', controlsHtml],
      ['<!--TABLE_HEADERS-->', headersHtml],
      ['<!--TABLE_ROWS-->', bodyHtml],
      ['<!--TABLE_PAGINATION-->', paginationHtml],
      ['<!--TABLE_FOOTER-->', options.footnote || ''],
      ['<!--TABLE_MODALS-->', modalsHtml]
    ];

    return replacements.reduce((output, [token, value]) => output.split(token).join(value || ''), template);
  }

  return renderTable;
}

module.exports = { createTableRenderer };
