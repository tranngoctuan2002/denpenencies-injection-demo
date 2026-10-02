namespace DiDemo.Web.Infrastructure;

/// <summary>
/// Extracts blocks between "// #region snippet:name" and "// #endregion" from the real source files,
/// so the code panels in the UI are always the code that actually runs.
/// </summary>
public class SnippetReader
{
    private readonly Dictionary<string, string> _snippets = new(StringComparer.OrdinalIgnoreCase);

    public SnippetReader()
    {
        var root = FindRoot(AppContext.BaseDirectory) ?? FindRoot(Directory.GetCurrentDirectory());
        if (root is null) return;

        foreach (var file in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
        {
            var sep = Path.DirectorySeparatorChar;
            if (file.Contains($"{sep}obj{sep}") || file.Contains($"{sep}bin{sep}") || file.Contains($"{sep}.nuget{sep}"))
                continue;
            Parse(File.ReadAllLines(file));
        }
    }

    private static string? FindRoot(string start)
    {
        var dir = new DirectoryInfo(start);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "DiDemo.sln"))) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    private void Parse(string[] lines)
    {
        string? name = null;
        List<string> buffer = [];
        foreach (var line in lines)
        {
            var t = line.Trim();
            if (t.StartsWith("// #region snippet:"))
            {
                name = t["// #region snippet:".Length..].Trim();
                buffer = [];
            }
            else if (t == "// #endregion" && name is not null)
            {
                _snippets[name] = Dedent(buffer);
                name = null;
            }
            else if (name is not null)
            {
                buffer.Add(line);
            }
        }
    }

    private static string Dedent(List<string> lines)
    {
        var indent = lines.Where(l => l.Trim().Length > 0)
            .Select(l => l.Length - l.TrimStart().Length)
            .DefaultIfEmpty(0).Min();
        return string.Join('\n', lines.Select(l => l.Length >= indent ? l[indent..] : l.TrimStart()));
    }

    public IReadOnlyDictionary<string, string> Get(IEnumerable<string> names) =>
        names.ToDictionary(n => n, n => _snippets.GetValueOrDefault(n, $"// snippet '{n}' not found"));
}
