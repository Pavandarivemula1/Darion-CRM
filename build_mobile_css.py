import re
import sys

def extract_block(css, start_search):
    match = re.search(start_search, css)
    if not match: return None, -1, -1
    start = match.end()
    brackets = 1
    end = start
    for i in range(start, len(css)):
        if css[i] == '{': brackets += 1
        elif css[i] == '}':
            brackets -= 1
            if brackets == 0:
                end = i
                break
    return css[start:end].strip(), match.start(), end + 1

with open('styles.css', 'r') as f:
    css = f.read()

# 1. Extract and remove mobile block
mobile_css, m_start, m_end = extract_block(css, r'@media\s*\(max-width:\s*768px\)\s*\{')
if not mobile_css:
    print("Mobile block not found")
    sys.exit(1)
css_no_mobile = css[:m_start] + css[m_end:]

# 2. Clean mobile css (remove !important)
mobile_css_clean = mobile_css.replace('!important', '')

# 3. Extract tablet block
tablet_css, t_start, t_end = extract_block(css_no_mobile, r'@media\s*\(max-width:\s*1100px\)\s*\{')
css_desktop = css_no_mobile
if tablet_css:
    css_desktop = css_no_mobile[:t_start] + css_no_mobile[t_end:]

# At this point:
# - css_desktop is the base CSS without any media queries
# - mobile_css_clean is the mobile overrides
# - tablet_css is the tablet overrides

# To make this mobile first:
# We want the base to be the base variables/resets + mobile layout.
# We want @media (min-width: 769px) to contain the desktop layout.
# But separating variables/resets from desktop layout is hard via script.
# Safest way: write a completely new styles.css by just wrapping the desktop layout.

# Find where reset ends.
reset_end = re.search(r'/\* ── Carbon Tile', css_desktop).start()
base_vars_resets = css_desktop[:reset_end]
desktop_layout = css_desktop[reset_end:]

new_css = f"""{base_vars_resets}
/* ============================================================
   MOBILE FIRST BASE (Formerly max-width: 768px)
   ============================================================ */
{mobile_css_clean}

/* ============================================================
   TABLET & DESKTOP (Formerly base styles)
   ============================================================ */
@media (min-width: 769px) {{
{desktop_layout}
}}

/* ============================================================
   LARGE DESKTOP (Formerly max-width: 1100px? Wait, that was for tablet)
   ============================================================ */
@media (min-width: 769px) and (max-width: 1100px) {{
{tablet_css}
}}
"""

with open('styles_new.css', 'w') as f:
    f.write(new_css)

print("Created styles_new.css successfully.")
