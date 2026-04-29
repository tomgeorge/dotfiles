{ inputs, ... }:

{
  config.flake.factory.user =
    {
      name,
      username,
      userFullName,
      userEmail,
      gpgKeyId ? "",
    }:
    {
      darwin."${name}" =
        { pkgs, ... }:
        {
          imports = [ inputs.self.modules.darwin.userOptions ];

          user = {
            inherit
              username
              userFullName
              userEmail
              gpgKeyId
              ;
          };

          users.users."${username}".home = "/Users/${username}";
          system.primaryUser = username;

          home-manager.users."${username}".imports = [
            inputs.self.modules.homeManager."${name}"
          ];
        };

      nixos."${name}" =
        { ... }:
        {
          imports = [ inputs.self.modules.nixos.userOptions ];

          user = {
            inherit
              username
              userFullName
              userEmail
              gpgKeyId
              ;
          };

          users.users."${username}" = {
            isNormalUser = true;
            home = "/home/${username}";
            extraGroups = [
              "wheel"
              "networkmanager"
            ];
          };

          home-manager.users."${username}".imports = [
            inputs.self.modules.homeManager."${name}"
          ];
        };

      homeManager."${name}" = {
        imports = [ inputs.self.modules.homeManager.userOptions ];

        user = {
          inherit
            username
            userFullName
            userEmail
            gpgKeyId
            ;
        };
      };
    };
}
