import re
import sys

def main():
    with open('styles.css', 'r', encoding='utf-8') as f:
        css = f.read()

    # Find the mobile block
    m = re.search(r'@media\s*\(max-width:\s*768px\)\s*\{', css)
    if not m:
        print("Mobile block not found")
        sys.exit(1)

    start = m.end()
    brackets = 1
    end = start
    for i in range(start, len(css)):
        if css[i] == '{': brackets += 1
        elif css[i] == '}':
            brackets -= 1
            if brackets == 0:
                end = i
                break

    mobile_css = css[start:end].strip()
    mobile_css_clean = mobile_css.replace('!important', '')

    # Find the tablet block
    t = re.search(r'@media\s*\(max-width:\s*1100px\)\s*\{', css)
    if t:
        t_start = t.end()
        t_brackets = 1
        t_end = t_start
        for i in range(t_start, len(css)):
            if css[i] == '{': t_brackets += 1
            elif css[i] == '}':
                t_brackets -= 1
                if t_brackets == 0:
                    t_end = i
                    break
        tablet_css = css[t_start:t_end].strip()
        tablet_block_start = t.start()
        tablet_block_end = t_end + 1
    else:
        tablet_css = ""
        tablet_block_start = -1
        tablet_block_end = -1

    # Remove mobile and tablet blocks from main CSS
    desktop_css = css[:m.start()] + css[end+1:]
    if tablet_block_start != -1:
        # Re-search in desktop_css since offsets changed
        t2 = re.search(r'@media\s*\(max-width:\s*1100px\)\s*\{', desktop_css)
        if t2:
            t2_start = t2.end()
            t2_b = 1
            t2_end = t2_start
            for i in range(t2_start, len(desktop_css)):
                if desktop_css[i] == '{': t2_b += 1
                elif desktop_css[i] == '}':
                    t2_b -= 1
                    if t2_b == 0:
                        t2_end = i
                        break
            desktop_css = desktop_css[:t2.start()] + desktop_css[t2_end+1:]

    # Desktop CSS includes everything EXCEPT the media queries we just removed.
    # However, Desktop CSS currently has all the variables and general styles.
    # We want to extract JUST the layout rules into @media (min-width: 768px).
    # But doing that programmatically is too hard.
    
    # EASIER APPROACH: 
    # Just append the `mobile_css_clean` to the top of the file (after variables).
    # Then wrap the desktop layout rules into `@media (min-width: 768px)` manually.
    print("Writing Python script to safely reorder CSS...")

if __name__ == "__main__":
    main()
