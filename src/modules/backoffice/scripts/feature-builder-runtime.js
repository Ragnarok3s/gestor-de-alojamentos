(function () {
  if (typeof window === "undefined") return;
  if (window.__featureBuilderBootstrapLoaded) {
    if (!window.__featureBuilderPresets) {
      window.__featureBuilderPresets = __FEATURE_PRESETS__;
    }
    if (typeof window.__initFeatureBuilders === "function") {
      window.__initFeatureBuilders();
    }
    return;
  }

  window.__featureBuilderBootstrapLoaded = true;

  var featurePresets = __FEATURE_PRESETS__;
  window.__featureBuilderPresets = featurePresets;

  var presetMap = featurePresets.reduce(function (acc, item) {
    acc[item.icon] = item;
    return acc;
  }, {});

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  function ensureIcons(target) {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({ root: target || document });
    }
  }

  function formatPresetLabel(icon, quantity) {
    var preset = presetMap[icon];
    var safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    if (!preset) return String(safeQuantity);
    var noun = safeQuantity === 1 ? preset.singular : preset.plural;
    return safeQuantity + " " + noun;
  }

  function buildEntryMeta(icon, value) {
    var preset = presetMap[icon];
    var raw = value == null ? "" : String(value).trim();
    var base = raw || "1";
    var quantity = null;
    if (/^\d+$/.test(base)) {
      var parsed = Number.parseInt(base, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        quantity = parsed;
        base = String(parsed);
      }
    }
    var display;
    if (quantity) {
      display = formatPresetLabel(icon, quantity);
    } else if (base) {
      display = base;
    } else if (preset) {
      display = preset.label;
    } else {
      display = icon;
    }
    return {
      value: base,
      quantity: quantity,
      display: display
    };
  }

  function serializeEntry(entry) {
    if (entry.raw) return entry.raw;
    var display = entry.display || "";
    if (!display) {
      display = typeof entry.value === "string" ? entry.value : "";
    }
    return entry.icon + "|" + display;
  }

  function initFeatureBuilder(root) {
    if (!root || root.dataset.featureBuilderReady === "true") return;
    var select = root.querySelector("[data-feature-select]");
    var detailInput = root.querySelector("[data-feature-detail]");
    var addButton = root.querySelector("[data-feature-add]");
    var list = root.querySelector("[data-feature-list]");
    var output = root.querySelector("[data-feature-output]");
    if (!select || !detailInput || !addButton || !list || !output) return;

    var picker = root.querySelector("[data-feature-picker]");
    var pickerToggle = root.querySelector("[data-feature-picker-toggle]");
    var pickerMenu = root.querySelector("[data-feature-picker-options]");
    var pickerPreview = root.querySelector("[data-feature-picker-preview]");
    var pickerLabel = root.querySelector("[data-feature-picker-label]");
    var placeholderClass = "feature-builder__icon-placeholder";
    var placeholderText = pickerLabel
      ? pickerLabel.getAttribute("data-placeholder") || pickerLabel.textContent || ""
      : "";

    var emptyText = list.getAttribute("data-empty-text") || "";
    var entries = [];

    function render() {
      if (!entries.length) {
        list.innerHTML = emptyText
          ? '<li class="feature-builder__empty">' + escapeHtml(emptyText) + "</li>"
          : "";
      } else {
        list.innerHTML = entries
          .map(function (entry, index) {
            if (entry.raw) {
              return (
                '<li class="feature-builder__item feature-builder__item--legacy" data-feature-item data-index="' +
                index +
                '"><span>' +
                escapeHtml(entry.raw) +
                '</span><button type="button" class="feature-builder__remove" data-feature-remove aria-label="Remover entrada personalizada">×</button></li>'
              );
            }
            var displayLabel = entry.display || "";
            var labelHtml = escapeHtml(displayLabel);
            var ariaLabel = displayLabel || entry.icon;
            return (
              '<li class="feature-builder__item" data-feature-item data-index="' +
              index +
              '"><span class="feature-builder__icon" aria-hidden="true"><i data-lucide="' +
              entry.icon +
              '"></i></span><span>' +
              labelHtml +
              '</span><button type="button" class="feature-builder__remove" data-feature-remove aria-label="Remover ' +
              escapeHtml(ariaLabel) +
              '">×</button></li>'
            );
          })
          .join("");
        ensureIcons(list);
      }
    }

    function sync() {
      output.value = entries.map(serializeEntry).join("\n");
      render();
    }

    function setSelectedIcon(icon) {
      var safeIcon = icon ? String(icon).toLowerCase() : "";
      if (select) {
        select.value = safeIcon;
      }
      if (pickerPreview) {
        if (safeIcon) {
          pickerPreview.innerHTML = '<i data-lucide="' + safeIcon + '"></i>';
          pickerPreview.classList.remove("is-empty");
        } else {
          pickerPreview.innerHTML = '<i data-lucide="plus"></i>';
          pickerPreview.classList.add("is-empty");
        }
        ensureIcons(pickerPreview);
      }
      if (pickerLabel) {
        var preset = safeIcon ? presetMap[safeIcon] : null;
        if (safeIcon && preset) {
          pickerLabel.textContent = preset.label;
          pickerLabel.classList.remove(placeholderClass);
        } else {
          pickerLabel.textContent = placeholderText;
          if (placeholderClass) {
            pickerLabel.classList.add(placeholderClass);
          }
        }
      }
      if (pickerMenu) {
        var options = pickerMenu.querySelectorAll("[data-icon-option]");
        options.forEach(function (option) {
          var isActive = option.getAttribute("data-icon") === safeIcon;
          option.classList.toggle("is-active", isActive);
          option.setAttribute("aria-selected", isActive ? "true" : "false");
        });
      }
    }

    function openMenu() {
      if (!pickerMenu || !pickerToggle) return;
      pickerMenu.hidden = false;
      pickerToggle.setAttribute("aria-expanded", "true");
      if (picker) picker.classList.add("is-open");
      ensureIcons(pickerMenu);
    }

    function closeMenu() {
      if (!pickerMenu || !pickerToggle) return;
      pickerMenu.hidden = true;
      pickerToggle.setAttribute("aria-expanded", "false");
      if (picker) picker.classList.remove("is-open");
    }

    function toggleMenu() {
      if (!pickerMenu) return;
      if (pickerMenu.hidden) {
        openMenu();
      } else {
        closeMenu();
      }
    }

    function upsertEntry(icon, detail) {
      if (!icon) return;
      var safeIcon = String(icon).toLowerCase();
      var meta = buildEntryMeta(safeIcon, detail);
      var existingIndex = entries.findIndex(function (entry) {
        return !entry.raw && entry.icon === safeIcon;
      });
      if (existingIndex >= 0) {
        entries[existingIndex].icon = safeIcon;
        entries[existingIndex].value = meta.value;
        entries[existingIndex].display = meta.display;
        entries[existingIndex].quantity = meta.quantity;
        delete entries[existingIndex].raw;
      } else {
        entries.push({
          icon: safeIcon,
          value: meta.value,
          display: meta.display,
          quantity: meta.quantity
        });
      }
    }

    var handleDocumentClick = function (event) {
      if (!pickerMenu || pickerMenu.hidden) return;
      if (picker && picker.contains(event.target)) return;
      closeMenu();
    };

    if (pickerToggle) {
      pickerToggle.addEventListener("click", function () {
        toggleMenu();
      });
    }

    if (pickerMenu) {
      pickerMenu.addEventListener("click", function (event) {
        var option = event.target.closest("[data-icon-option]");
        if (!option) return;
        var icon = option.getAttribute("data-icon") || "";
        setSelectedIcon(icon);
        closeMenu();
        detailInput.focus();
      });
      pickerMenu.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeMenu();
          if (pickerToggle) pickerToggle.focus();
        }
      });
    }

    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    });

    document.addEventListener("click", handleDocumentClick);

    if (picker) {
      ensureIcons(picker);
    }

    function initialiseEntries() {
      var initialRaw = String(output.value || "");
      if (!initialRaw.trim()) {
        render();
        return;
      }
      initialRaw
        .split(/\r?\n/)
        .map(function (line) {
          return line.trim();
        })
        .filter(Boolean)
        .forEach(function (line) {
          var pipeIndex = line.indexOf("|");
          if (pipeIndex > -1) {
            var icon = line.slice(0, pipeIndex).trim().toLowerCase();
            var label = line.slice(pipeIndex + 1).trim();
            if (icon && presetMap[icon]) {
              var meta = buildEntryMeta(icon, label);
              entries.push({
                icon: icon,
                value: meta.value,
                display: meta.display,
                quantity: meta.quantity
              });
              return;
            }
          }
          entries.push({ raw: line });
        });
      sync();
    }

    initialiseEntries();
    setSelectedIcon(select.value || "");

    addButton.addEventListener("click", function () {
      var icon = select.value;
      if (!icon) {
        if (pickerToggle) {
          pickerToggle.focus();
          openMenu();
        } else {
          select.focus();
        }
        return;
      }
      upsertEntry(icon, detailInput.value);
      sync();
      setSelectedIcon("");
      detailInput.value = "";
      detailInput.focus();
    });

    detailInput.addEventListener("focus", function () {
      closeMenu();
    });

    list.addEventListener("click", function (event) {
      var trigger = event.target.closest("[data-feature-remove]");
      if (!trigger) return;
      var item = trigger.closest("[data-feature-item]");
      if (!item) return;
      var index = Number.parseInt(item.getAttribute("data-index"), 10);
      if (Number.isInteger(index)) {
        entries.splice(index, 1);
        sync();
      }
    });

    root.dataset.featureBuilderReady = "true";
  }

  function initFeatureBuilders() {
    document.querySelectorAll("[data-feature-builder]").forEach(initFeatureBuilder);
  }

  window.__initFeatureBuilders = initFeatureBuilders;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFeatureBuilders);
  } else {
    initFeatureBuilders();
  }
})();
