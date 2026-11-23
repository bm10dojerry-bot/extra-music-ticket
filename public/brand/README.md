# EXTRA stage logo

The homepage uses `extra-stage-logo.webp` (1024 × 683, 227,052 bytes). The source
cutout is `extra-stage-logo.png` (1536 × 1024, 1,388,954 bytes). Both contain a real
transparent alpha channel; the black background is not simulated with blend modes.

Source: the project owner's uploaded `Logo _+1 EXTRA Music SHOW_ Monochrome.png`.
The cutout was produced with the built-in Imagegen tool in edit mode, using the
supplied image and `transparent_background: true`. The PNG is the unmodified tool
output. The WebP was resized with Lanczos3 and encoded losslessly for the website;
no additional masking or redrawing was performed. The result was inspected on
both dark and light backgrounds, including the enclosed gaps in the lettering.

PNG SHA-256: `6d6e0a6dcca544b88c8453151ee19743543283030dcdc3e053caaacc157d6b4c`.

WebP SHA-256: `944df083424e0fa0f447f59eaed3d53aa0422622155055664f162177ee549342`.

## Background-removal prompt

```text
Use case: background-extraction.
Asset type: exact brand-logo cutout for a website stage-opening animation.
Input image 1 is the edit target, not a style reference.
Primary request: remove ONLY the black background and deliver the same logo on a true transparent alpha background.
Preserve the exact original +1 symbol and sweeping ribbon geometry, the exact EXTRA block lettering, the exact red handwritten Music lettering and red underline, and the exact SHOW lettering and flanking silver strokes. Preserve all positions, proportions, spacing, slants, metallic silver gradients, white highlights, gray shading, sharp edges, and the vivid red color. Do not redraw, reinterpret, retype, simplify, or add anything.
Text (verbatim): "+1 EXTRA Music SHOW". Keep every letter and stroke exactly as supplied.
Remove black background everywhere, including the enclosed black counters and gaps inside and between lettering and curved elements, so all those empty regions have actual alpha=0. Preserve legitimate gray metallic shading in the logo itself. Clean the background matte from the edges without adding halos.
Keep the original composition and aspect ratio with the entire logo visible and no clipped extremities.
Avoid: any black rectangle, checkerboard painted into the image, white background, new decoration, glow, drop shadow, added art, added lettering, changed typography, changed logo design.
Output: a clean transparent-background PNG logo cutout with a real alpha channel.
```
