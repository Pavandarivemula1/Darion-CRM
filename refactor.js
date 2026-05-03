const fs = require('fs');
const css = require('css');

const stylesheet = fs.readFileSync('styles.css', 'utf8');
const ast = css.parse(stylesheet);

let mobileMediaRule = null;
let tabletMediaRule = null;
const baseRules = ast.stylesheet.rules.filter(r => r.type === 'rule');

// Find media queries
const mediaRules = ast.stylesheet.rules.filter(r => r.type === 'media');
for (const rule of mediaRules) {
    if (rule.media.includes('max-width: 768px')) {
        mobileMediaRule = rule;
    } else if (rule.media.includes('max-width: 1100px')) {
        tabletMediaRule = rule;
    }
}

if (!mobileMediaRule) {
    console.log("Mobile media rule not found.");
    process.exit(1);
}

// We will create a new media query for desktop: @media (min-width: 769px)
const desktopMediaRule = {
    type: 'media',
    media: '(min-width: 769px)',
    rules: []
};

// Map of base rules by selector
const baseRuleMap = new Map();
for (const rule of baseRules) {
    // We join selectors to make a key, e.g. "html, body"
    const sel = rule.selectors.join(', ');
    baseRuleMap.set(sel, rule);
}

// Now process the mobile overrides
for (const mobileRule of mobileMediaRule.rules) {
    if (mobileRule.type !== 'rule') continue;
    
    const sel = mobileRule.selectors.join(', ');
    const baseRule = baseRuleMap.get(sel);

    if (baseRule) {
        // We have an override. 
        // 1. Move the conflicting base declarations into desktopMediaRule
        // 2. Put the mobile declarations into baseRule

        const desktopDeclProps = [];
        
        for (const mDecl of mobileRule.declarations) {
            if (mDecl.type !== 'declaration') continue;
            const prop = mDecl.property;
            const mVal = mDecl.value.replace(/\s*!important/g, ''); // Strip !important
            
            // Find this property in base rule
            const bDeclIndex = baseRule.declarations.findIndex(d => d.type === 'declaration' && d.property === prop);
            
            if (bDeclIndex !== -1) {
                // Move base declaration to desktop rule
                const bDecl = baseRule.declarations[bDeclIndex];
                desktopDeclProps.push({ property: prop, value: bDecl.value });
                
                // Replace base declaration with mobile value
                baseRule.declarations[bDeclIndex].value = mVal;
            } else {
                // Base rule doesn't have this property, just append it
                baseRule.declarations.push({
                    type: 'declaration',
                    property: prop,
                    value: mVal
                });
            }
        }

        // Create a rule in desktopMediaRule to hold the displaced base properties
        if (desktopDeclProps.length > 0) {
            desktopMediaRule.rules.push({
                type: 'rule',
                selectors: mobileRule.selectors,
                declarations: desktopDeclProps.map(p => ({
                    type: 'declaration',
                    property: p.property,
                    value: p.value
                }))
            });
        }
    } else {
        // No matching base rule. Just append the mobile rule to the base rules
        // Strip !important
        for (const mDecl of mobileRule.declarations) {
            if (mDecl.type === 'declaration') {
                mDecl.value = mDecl.value.replace(/\s*!important/g, '');
            }
        }
        ast.stylesheet.rules.splice(ast.stylesheet.rules.indexOf(mobileMediaRule), 0, mobileRule);
    }
}

// Remove the old mobile media rule
ast.stylesheet.rules = ast.stylesheet.rules.filter(r => r !== mobileMediaRule);

// Add the new desktop media rule at the bottom
ast.stylesheet.rules.push(desktopMediaRule);

// For tablet, convert (max-width: 1100px) to something appropriate or leave as is. 
// We will just leave tablet as max-width for now to not break it.

const newCss = css.stringify(ast);
fs.writeFileSync('styles_mobile_first.css', newCss);
console.log("Successfully generated styles_mobile_first.css");
