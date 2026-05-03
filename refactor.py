import re
import sys

def main():
    try:
        with open('styles.css', 'r', encoding='utf-8') as f:
            css = f.read()
    except FileNotFoundError:
        print("styles.css not found.")
        sys.exit(1)

    # 1. Locate the @media (max-width: 768px) block
    mobile_media_match = re.search(r'@media\s*\(max-width:\s*768px\)\s*\{', css)
    if not mobile_media_match:
        print("Mobile block not found!")
        sys.exit(1)

    start_idx = mobile_media_match.end()
    bracket_count = 1
    end_idx = start_idx

    for i in range(start_idx, len(css)):
        if css[i] == '{':
            bracket_count += 1
        elif css[i] == '}':
            bracket_count -= 1
            if bracket_count == 0:
                end_idx = i
                break

    mobile_css_raw = css[start_idx:end_idx].strip()
    
    # Remove the mobile block and the tablet block from the original CSS
    # First, let's also find the tablet block @media (max-width: 1100px)
    tablet_media_match = re.search(r'@media\s*\(max-width:\s*1100px\)\s*\{', css)
    
    css_cleaned = css
    if tablet_media_match:
        t_start = tablet_media_match.start()
        t_inner_start = tablet_media_match.end()
        t_bracket = 1
        t_end = t_inner_start
        for i in range(t_inner_start, len(css)):
            if css[i] == '{': t_bracket += 1
            elif css[i] == '}':
                t_bracket -= 1
                if t_bracket == 0:
                    t_end = i
                    break
        css_cleaned = css[:t_start] + css[t_end+1:]
        tablet_css = css[t_inner_start:t_end].strip()
    else:
        tablet_css = ""

    # Now remove the mobile block from css_cleaned
    mobile_media_match_clean = re.search(r'@media\s*\(max-width:\s*768px\)\s*\{', css_cleaned)
    if mobile_media_match_clean:
        m_start = mobile_media_match_clean.start()
        m_inner_start = mobile_media_match_clean.end()
        m_bracket = 1
        m_end = m_inner_start
        for i in range(m_inner_start, len(css_cleaned)):
            if css_cleaned[i] == '{': m_bracket += 1
            elif css_cleaned[i] == '}':
                m_bracket -= 1
                if m_bracket == 0:
                    m_end = i
                    break
        css_desktop = css_cleaned[:m_start] + css_cleaned[m_end+1:]
    else:
        css_desktop = css_cleaned

    # Clean the !important flags from the mobile CSS because it will now be the base
    mobile_css_clean = mobile_css_raw.replace('!important', '')

    # We need to construct the new CSS.
    # To avoid having to manually merge properties (which is hard to do safely), 
    # we will output:
    # 1. The original base variables and resets
    # 2. The mobile base styles (mobile_css_clean)
    # 3. @media (min-width: 768px) { <original base styles except variables/resets> }
    # 4. @media (max-width: 1100px) { <original tablet styles> } (Wait, tablet styles were max-width, maybe we should keep them as min-width 768px and max-width 1100px)
    
    # Actually, a much safer approach: 
    # Just output the original CSS, but wrap the desktop-specific parts in @media (min-width: 768px) manually, 
    # rather than trying to automate an imperfect text manipulation.
    print("CSS Refactor Script is too risky to run automated without a real CSS parser. Exiting.")

if __name__ == "__main__":
    main()
