class Etemaro < Formula
  desc "Autonomous DLMM LP agent for Meteora on Solana"
  homepage "https://github.com/romankurnovskii/etemaro"
  version "3.7.0"
  url "https://registry.npmjs.org/@etemaro/cli/-/cli-3.7.0.tgz"
  sha256 "c8d3eae160a892e32837db3dcae515e843e5383fef52b8141940c8bcf8b6d59f"
  
  depends_on "node"

  def install
    # Install dependencies and build if necessary, but since we are downloading from npm, 
    # it's already built. We just need to link the executable.
    libexec.install Dir["*"]
    bin.install_symlink libexec/"dist/Cli.cjs" => "etemaro"
  end

  test do
    system "#{bin}/etemaro", "help"
  end
end
