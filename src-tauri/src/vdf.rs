//! Bounded parser for Valve's text KeyValues format (not binary appcache files).
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub enum Value {
    Text(String),
    Object(BTreeMap<String, Value>),
}
impl Value {
    pub fn text(&self) -> Option<&str> {
        if let Self::Text(s) = self {
            Some(s)
        } else {
            None
        }
    }
    pub fn object(&self) -> Option<&BTreeMap<String, Value>> {
        if let Self::Object(m) = self {
            Some(m)
        } else {
            None
        }
    }
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.object()?.get(key)
    }
    pub fn string(&self, key: &str) -> Option<&str> {
        self.get(key)?.text()
    }
}

pub fn parse(input: &str) -> Result<Value, String> {
    if input.len() > 16 * 1024 * 1024 {
        return Err("Valve manifest is too large".into());
    }
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            c if c.is_whitespace() || c == '\u{feff}' => i += 1,
            '/' if chars.get(i + 1) == Some(&'/') => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            '{' | '}' => {
                tokens.push(chars[i].to_string());
                i += 1;
            }
            '"' => {
                i += 1;
                let mut text = String::new();
                let mut closed = false;
                while i < chars.len() {
                    if chars[i] == '"' {
                        i += 1;
                        closed = true;
                        break;
                    }
                    if chars[i] == '\\'
                        && i + 1 < chars.len()
                        && (chars[i + 1] == '\\' || chars[i + 1] == '"')
                    {
                        i += 1;
                    }
                    text.push(chars[i]);
                    i += 1;
                }
                if !closed {
                    return Err("Unterminated manifest string".into());
                }
                tokens.push(text);
            }
            _ => {
                let start = i;
                while i < chars.len()
                    && !chars[i].is_whitespace()
                    && chars[i] != '{'
                    && chars[i] != '}'
                {
                    i += 1;
                }
                tokens.push(chars[start..i].iter().collect());
            }
        }
    }
    fn object(
        tokens: &[String],
        pos: &mut usize,
        nested: bool,
        depth: usize,
    ) -> Result<Value, String> {
        if depth > 32 {
            return Err("Manifest nesting limit exceeded".into());
        }
        let mut out = BTreeMap::new();
        while *pos < tokens.len() {
            if tokens[*pos] == "}" {
                if !nested {
                    return Err("Unexpected closing brace".into());
                }
                *pos += 1;
                return Ok(Value::Object(out));
            }
            let key = tokens[*pos].clone();
            *pos += 1;
            let next = tokens.get(*pos).ok_or("Missing manifest value")?;
            *pos += 1;
            let value = if next == "{" {
                object(tokens, pos, true, depth + 1)?
            } else if next == "}" {
                return Err("Missing manifest value".into());
            } else {
                Value::Text(next.clone())
            };
            out.insert(key, value);
        }
        if nested {
            return Err("Unclosed manifest object".into());
        }
        Ok(Value::Object(out))
    }
    object(&tokens, &mut 0, false, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_libraries_and_windows_escapes() {
        let root = parse(r#""libraryfolders" { "0" { "path" "C:\\Program Files (x86)\\Steam" "apps" { "1245620" "1000" } } }"#).unwrap();
        assert_eq!(
            root.get("libraryfolders")
                .unwrap()
                .get("0")
                .unwrap()
                .string("path"),
            Some(r"C:\Program Files (x86)\Steam")
        );
    }
    #[test]
    fn rejects_truncated_and_malformed_data() {
        assert!(parse("\"AppState\" { \"name\" \"unfinished").is_err());
        assert!(parse("\"a\" { \"b\" \"c\"").is_err());
        assert!(parse("}").is_err());
    }
    #[test]
    fn supports_comments_and_unicode() {
        let v = parse("// test\n\"name\" \"Pokémon \t世界\"").unwrap();
        assert_eq!(v.string("name"), Some("Pokémon \t世界"));
    }
}
