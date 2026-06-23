# Validation & fidelity report — A2UI v0.9.1

Emitted components: `Button`, `Card`, `TextField`, `Text`, `Column`
Primary color token: tokens.color.primary → `#0f172a`

## Validation — ✅ PASS (hard gate)

| Gate | Result | Detail |
| --- | --- | --- |
| schema-compile + no-external-ref | ✅ pass | Catalog compiles as a draft-2020-12 JSON Schema with only internal $refs. |
| catalog-shape | ✅ pass | Catalog satisfies the A2UI v0.9.1 catalog-shape meta-schema. |
| instance | ✅ pass | All 7 surface component instance(s) validate against #/$defs/anyComponent. |

## Fidelity summary

| Class | Count |
| --- | --- |
| maps cleanly | 6 |
| requires synthesis / defaults | 12 |
| currently lossy | 3 |
| cannot be represented | 27 |

## Fidelity — per field

| Source (dspack) | Target (A2UI) | Class | Note |
| --- | --- | --- | --- |
| `components.button.description` | `components.Button.description` | maps cleanly | dspack component description carried verbatim into the catalog component. |
| `components.button` | `components.Button.properties.child` | requires synthesis / defaults | A2UI Buttons render a child component by ID; dspack Button has no equivalent slot (children are arbitrary React nodes). |
| `components.button` | `components.Button.properties.action` | requires synthesis / defaults | A2UI requires a declarative action; dspack expresses this as an onClick handler prop, which is not representable in a declarative catalog. |
| `components.button.props.variant` | `components.Button.properties.variant` | currently lossy | Enum projected 6->3 (many-to-one); distinct source variants collapse. |
| `components.button.props.size` | `(dropped)` | cannot be represented | No A2UI Button property corresponds to 'size'. |
| `components.button.props.disabled` | `(dropped)` | cannot be represented | No A2UI Button property corresponds to 'disabled'. |
| `components.button.props.asChild` | `(dropped)` | cannot be represented | No A2UI Button property corresponds to 'asChild'. |
| `components.button.accessibility` | `(dropped)` | cannot be represented | dspack accessibility is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.button.constraints` | `(dropped)` | cannot be represented | dspack constraints is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.button.whenToUse` | `(dropped)` | cannot be represented | dspack whenToUse is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.button.whenNotToUse` | `(dropped)` | cannot be represented | dspack whenNotToUse is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.button.{status,tags}` | `components.Button.x-dspack` | maps cleanly | dspack status/tags carried as catalog component metadata (x-dspack annotation). |
| `components.card.description` | `components.Card.description` | maps cleanly | dspack component description carried verbatim into the catalog component. |
| `components.card` | `components.Card.properties.child` | requires synthesis / defaults | A2UI Card takes exactly one child by ID; dspack Card composes via sub-components (CardHeader/CardContent/CardFooter), which collapse to a single child slot. |
| `components.card.props.className` | `(dropped)` | cannot be represented | No A2UI Card property corresponds to 'className'. |
| `components.card.composition` | `(dropped)` | cannot be represented | dspack composition is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.card.constraints` | `(dropped)` | cannot be represented | dspack constraints is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.card.whenToUse` | `(dropped)` | cannot be represented | dspack whenToUse is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.card.whenNotToUse` | `(dropped)` | cannot be represented | dspack whenNotToUse is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.card.{status,tags}` | `components.Card.x-dspack` | maps cleanly | dspack status/tags carried as catalog component metadata (x-dspack annotation). |
| `components.input.description` | `components.TextField.description` | maps cleanly | dspack component description carried verbatim into the catalog component. |
| `components.input` | `components.TextField.properties.label` | requires synthesis / defaults | A2UI TextField owns its label; dspack Input relies on an external <label> element, so the label is synthesized. |
| `components.input` | `components.TextField.properties.value` | requires synthesis / defaults | A2UI two-way-binds value; dspack Input has no value prop in the contract. |
| `components.input.props.type` | `components.TextField.properties.variant` | currently lossy | Enum projected 5->3 (many-to-one); distinct source variants collapse. |
| `components.input.props.placeholder` | `(dropped)` | cannot be represented | No A2UI TextField property corresponds to 'placeholder'. |
| `components.input.props.disabled` | `(dropped)` | cannot be represented | No A2UI TextField property corresponds to 'disabled'. |
| `components.input.accessibility` | `(dropped)` | cannot be represented | dspack accessibility is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.input.constraints` | `(dropped)` | cannot be represented | dspack constraints is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.input.whenToUse` | `(dropped)` | cannot be represented | dspack whenToUse is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.input.whenNotToUse` | `(dropped)` | cannot be represented | dspack whenNotToUse is design-intent / a11y knowledge with no A2UI catalog representation. |
| `components.input.{status,tags}` | `components.TextField.x-dspack` | maps cleanly | dspack status/tags carried as catalog component metadata (x-dspack annotation). |
| `(synthesized)` | `components.Text.properties.text` | requires synthesis / defaults | A2UI content primitive required to render labels/titles in a surface. |
| `(synthesized)` | `components.Text.properties.variant` | requires synthesis / defaults | A2UI-native property declared on a synthesized primitive (no dspack source). |
| `(synthesized)` | `components.Column.properties.children` | requires synthesis / defaults | A2UI structural primitive required to compose multiple children. |
| `(synthesized)` | `components.Column.properties.justify` | requires synthesis / defaults | A2UI-native property declared on a synthesized primitive (no dspack source). |
| `(synthesized)` | `components.Column.properties.align` | requires synthesis / defaults | A2UI-native property declared on a synthesized primitive (no dspack source). |
| `components.badge` | `components.Text` | currently lossy | shadcn Badge has no native A2UI component. Its instances fold onto the Text primitive; the status-label semantics and the variant enum (default/secondary/outline/destructive) have no representation and are lost. |
| `components.dialog` | `components.Modal` | cannot be represented | dspack Dialog is a compound component (DialogTrigger/Content/Header/Title/Description/Footer/Close) with required-children composition rules, focus management, and a11y roles. A2UI Modal exposes only trigger+content; the composition contract cannot be represented. |
| `components.alert-dialog` | `components.Modal` | cannot be represented | Same composition loss as Dialog, plus the defining AlertDialog semantics (non-dismissible, alertdialog role, focus-to-cancel) have no A2UI catalog representation. |
| `components.dropdown-menu` | `(omitted)` | cannot be represented | No A2UI basic component corresponds to a dropdown menu (items, checkbox/radio items, sub-menus, separators). Omitted. |
| `tokens.color.primary` | `theme.primaryColor / surfaceProperties.x-dspack-tokens` | requires synthesis / defaults | dspack 'hsl(222.2, 47.4%, 11.2%)' converted to '#0f172a' to satisfy theme.primaryColor's #rrggbb pattern. |
| `tokens.*` | `theme/surfaceProperties.x-dspack-tokens` | requires synthesis / defaults | Full token palette carried as a documented extension (additionalProperties allows it). |
| `tokens.*.{tier,aliasOf}` | `(dropped)` | cannot be represented | Token tier/alias relationships have no A2UI representation; only resolved values survive. |
| `patterns` | `(dropped)` | cannot be represented | Usage patterns (preferred component combinations): A2UI catalogs describe renderable component shape, not design intent. Deliberate casualty. |
| `antiPatterns` | `(dropped)` | cannot be represented | Anti-patterns (deliberately ruled-out approaches): A2UI catalogs describe renderable component shape, not design intent. Deliberate casualty. |
| `frameworkBindings` | `(dropped)` | cannot be represented | Framework bindings (import paths / packages): A2UI catalogs describe renderable component shape, not design intent. Deliberate casualty. |
| `layout` | `(dropped)` | cannot be represented | Layout primitives (breakpoints/grid/containers/spacing): A2UI catalogs describe renderable component shape, not design intent. Deliberate casualty. |
| `themes` | `(dropped)` | cannot be represented | Named theme overrides (e.g. dark mode): A2UI catalogs describe renderable component shape, not design intent. Deliberate casualty. |

## Warnings (unsupported dspack constructs)

- **dropped-prop:button.size** — dspack button.size has no A2UI representation and was dropped.
- **dropped-prop:button.disabled** — dspack button.disabled has no A2UI representation and was dropped.
- **dropped-prop:button.asChild** — dspack button.asChild has no A2UI representation and was dropped.
- **dropped-prop:card.className** — dspack card.className has no A2UI representation and was dropped.
- **dropped-prop:input.placeholder** — dspack input.placeholder has no A2UI representation and was dropped.
- **dropped-prop:input.disabled** — dspack input.disabled has no A2UI representation and was dropped.
- **unsupported-component:badge** — dspack component 'badge' folds onto Text with loss: shadcn Badge has no native A2UI component. Its instances fold onto the Text primitive; the status-label semantics and the variant enum (default/secondary/outline/destructive) have no representation and are lost.
- **unsupported-component:dialog** — dspack component 'dialog' cannot be represented: dspack Dialog is a compound component (DialogTrigger/Content/Header/Title/Description/Footer/Close) with required-children composition rules, focus management, and a11y roles. A2UI Modal exposes only trigger+content; the composition contract cannot be represented.
- **unsupported-component:alert-dialog** — dspack component 'alert-dialog' cannot be represented: Same composition loss as Dialog, plus the defining AlertDialog semantics (non-dismissible, alertdialog role, focus-to-cancel) have no A2UI catalog representation.
- **unsupported-component:dropdown-menu** — dspack component 'dropdown-menu' cannot be represented: No A2UI basic component corresponds to a dropdown menu (items, checkbox/radio items, sub-menus, separators). Omitted.
- **unsupported-section:patterns** — dspack 'patterns' has no A2UI catalog representation (deliberate casualty).
- **unsupported-section:antiPatterns** — dspack 'antiPatterns' has no A2UI catalog representation (deliberate casualty).
- **unsupported-section:frameworkBindings** — dspack 'frameworkBindings' has no A2UI catalog representation (deliberate casualty).
- **unsupported-section:layout** — dspack 'layout' has no A2UI catalog representation (deliberate casualty).
- **unsupported-section:themes** — dspack 'themes' has no A2UI catalog representation (deliberate casualty).
