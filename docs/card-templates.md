# Card templates

Neo Anki renders every core card from structured data with the app’s native components.

## Content types and fields

A content type defines the named fields filled when knowledge is created, such as `Prompt`, `Answer`, and `Context`. Create or edit content types under **Settings → Card templates → Fields and card layouts**.

Each content type can have any number of fields. Template prompt and answer fields are required during authoring; supporting fields remain optional.

## Card templates

A card template defines:

- the field shown as the prompt;
- the field shown as the answer;
- optional supporting fields shown after reveal;
- reveal or typed-answer interaction.

Every template on the selected content type creates one card when a knowledge item is added. Multiple templates can reuse the same fields—for example, a normal recall card and a reverse recall card.

Templates contain no HTML, CSS, scripts, or presentation markup. Review, Library, the authoring preview, desktop persistence, and mobile all call the same structured projector. Typography, spacing, colors, focus behavior, and responsive layout therefore stay consistent with the rest of the app.

## Import and export

External imports may contain legacy template markup or scheduling fields. The importer materializes their visible prompt and answer into native fields before the workspace is accepted. Original source metadata may be retained for rollback and export, but it is never used to render cards at runtime.
