import { useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import "../primitives/primitives.css";
import "./recipes.css";

export interface CommandSearchItem {
  id: string;
  label: string;
  hint: string;
}

export interface CommandSearchProps {
  label: string;
  placeholder: string;
  items: readonly CommandSearchItem[];
  onSelect: (item: CommandSearchItem) => void;
  testId?: string;
}

/**
 * CommandSearch recipe (plan.md §10.4): the slash-command palette. Built
 * from a clean specification of the WAI-ARIA
 * "combobox with list autocomplete" pattern, not copied code (plan.md
 * §10.1).
 *
 * Accessibility (plan.md §10.5): `role="combobox"` input with
 * `aria-expanded`/`aria-activedescendant`, a `role="listbox"` of
 * `role="option"`s, ArrowUp/ArrowDown to move the active option, Enter to
 * choose it, Escape to close — full keyboard operation without a mouse.
 */
export function CommandSearch({ label, placeholder, items, onSelect, testId }: CommandSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputId = useId();
  const listboxId = useId();

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.hint.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, query],
  );

  const activeItem = filtered[activeIndex];
  const activeId = activeItem ? `${listboxId}-${activeItem.id}` : undefined;

  function choose(item: CommandSearchItem) {
    onSelect(item);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (open && activeItem) {
        event.preventDefault();
        choose(activeItem);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="pc-command-search">
      <label className="pc-visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? activeId : undefined}
        aria-autocomplete="list"
        className="pc-command-search__input"
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      {open ? (
        <ul id={listboxId} role="listbox" aria-label={label} className="pc-command-search__list">
          {filtered.length === 0 ? (
            <li className="pc-command-search__empty">No matching commands</li>
          ) : (
            filtered.map((item, index) => (
              <li
                key={item.id}
                id={`${listboxId}-${item.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`pc-command-search__option${index === activeIndex ? " pc-command-search__option--active" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(item);
                }}
              >
                <span className="pc-command-search__option-label">{item.label}</span>
                <span className="pc-command-search__option-hint">{item.hint}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export default CommandSearch;
