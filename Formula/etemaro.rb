class Etemaro < Formula
  desc "Etemaro LP Strategy CLI"
  homepage "https://etemaro.com"
  version "3.4.2" # This will be updated by release workflow
  url "https://registry.npmjs.org/@etemaro/cli/-/cli-3.4.2.tgz"
  
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
