# CV

Source repository for my CV, typeset with [Typst](https://typst.app/).

Sensitive contact details are intentionally **not stored in this repository**. They are read from a local `personal.yaml` file that is ignored by Git. An optional profile photo is also local-only.

## Repository contents

- `cv.typ` — CV layout and public content.
- `personal.example.yaml` — example structure for local private contact data.
- `personal.yaml` — local private data; never commit this file.
- `photo.jpg` / `photo.png` / `photo.webp` — optional local profile photo; never commit it.
- `build.ps1` — optimizes the local profile photo when enabled and builds the final PDF into `output/`.
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
   show_photo: false
   photo_path: "photo.jpg"
   ```

4. Optional: put your profile photo next to `cv.typ` (for example `photo.jpg`) and set `show_photo: true`. During the build, the photo is center-cropped and resized to a temporary 450×450 JPEG before it is embedded in the PDF; the original file is never modified.
5. Build the CV:

   ```powershell
   .\build.ps1
   ```

The generated file will be written to:

```text
output/Vitalii_Hanych_CV.pdf
```

## Privacy rule

Never force-add `personal.yaml`, your local photo, or generated PDF files to Git. If sensitive information is ever committed to a public repository, deleting the branch or commit later should not be treated as sufficient protection.
