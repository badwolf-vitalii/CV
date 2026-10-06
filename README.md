# CV

Source repository for my CV, typeset with [Typst](https://typst.app/).

Sensitive contact details are intentionally **not stored in this repository**. They are read from a local `personal.yaml` file that is ignored by Git.

## Repository contents

- `cv.typ` — CV layout and public content.
- `personal.example.yaml` — example structure for local private contact data.
- `personal.yaml` — local private data; never commit this file.
- `build.ps1` — builds the final PDF into `output/`.
- `.github/workflows/privacy-check.yml` — fails CI if private/generated files are accidentally tracked.

## Build on Windows

1. Install the Typst CLI and make sure `typst` is available in `PATH`.
2. Create your local private data file:

   ```powershell
   Copy-Item personal.example.yaml personal.yaml
   ```

3. Edit `personal.yaml` and fill in your real contact details:

   ```yaml
   location: "City, Country"
   phone: "+00 000 0000000"
   email: "name@example.com"
   ```

4. Build the CV:

   ```powershell
   .\build.ps1
   ```

The generated file will be written to:

```text
output/Vitalii_Hanych_CV.pdf
```

## Privacy rule

Never force-add `personal.yaml` or generated PDF files to Git. If sensitive information is ever committed to a public repository, deleting the branch or commit later should not be treated as sufficient protection.
